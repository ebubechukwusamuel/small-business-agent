import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendGmailMessage } from "@/lib/gmail";

export const dynamic = "force-dynamic";

type DraftRow = {
  id: string;
  workspace_id: string;
  lead_id: string;
  subject: string;
  body: string;
  status: string;
  approved_by: string | null;
  approved_at: string | null;
  provider_message_id: string | null;
  sent_at: string | null;
};

function isDemoAddress(email: string) {
  const normalized = email.trim().toLowerCase();
  const domain = normalized.split("@")[1] || "";
  return domain.endsWith(".example") || domain.endsWith(".test") || domain.endsWith(".invalid") ||
    /@example\.(com|org|net)$/.test(normalized);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

  let body: { draftId?: string; workspaceId?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  if (!body.draftId || !body.workspaceId) {
    return NextResponse.json({ error: "A draft and workspace are required." }, { status: 400 });
  }

  const { data: member, error: memberError } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", body.workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (memberError || !member || !["owner", "admin"].includes(member.role)) {
    return NextResponse.json({ error: "Only workspace owners or admins can send an approved draft." }, { status: 403 });
  }

  const { data: draft, error: draftError } = await supabase
    .from("follow_up_drafts")
    .select("id,workspace_id,lead_id,subject,body,status,approved_by,approved_at,provider_message_id,sent_at")
    .eq("id", body.draftId)
    .eq("workspace_id", body.workspaceId)
    .maybeSingle();
  if (draftError || !draft) return NextResponse.json({ error: "Draft not found in this workspace." }, { status: 404 });
  const draftRow = draft as DraftRow;
  if (draftRow.status !== "approved" || !draftRow.approved_by || !draftRow.approved_at) {
    return NextResponse.json({ error: "Only a draft that has been approved can be sent." }, { status: 409 });
  }
  if (draftRow.provider_message_id || draftRow.sent_at) {
    return NextResponse.json({ error: "This draft has already been sent or is being processed. Refresh the page before retrying." }, { status: 409 });
  }

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id,workspace_id,company_name,contact_name,email")
    .eq("id", draftRow.lead_id)
    .eq("workspace_id", body.workspaceId)
    .maybeSingle();
  if (leadError || !lead) return NextResponse.json({ error: "The lead connected to this draft could not be found." }, { status: 404 });
  if (!lead.email) return NextResponse.json({ error: "This lead has no email address." }, { status: 400 });
  if (isDemoAddress(lead.email)) {
    return NextResponse.json({ error: "Sending is blocked for fictional demo/test addresses. Replace the sample lead with a real, permitted recipient first." }, { status: 400 });
  }

  const claim = await supabase.rpc("claim_gmail_send", { p_draft_id: draftRow.id });
  if (claim.error) return NextResponse.json({ error: claim.error.message }, { status: 409 });

  let gmailResult: { id: string; threadId?: string };
  try {
    gmailResult = await sendGmailMessage(user.id, {
      to: lead.email.trim(),
      subject: draftRow.subject,
      body: draftRow.body,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gmail failed to send the message.";
    // Clear the claim for known setup/configuration problems. Keep it locked on ambiguous
    // network failures to avoid sending a duplicate if Gmail accepted the message already.
    if (/Connect Gmail|Google OAuth|refresh the connected Gmail session|Gmail access was refused|not configured/i.test(message)) {
      await supabase.rpc("clear_gmail_send_claim", { p_draft_id: draftRow.id });
    }
    return NextResponse.json({
      error: message,
      mayHaveSent: !/Connect Gmail|Google OAuth|refresh the connected Gmail session|Gmail access was refused|not configured/i.test(message),
    }, { status: 502 });
  }

  const recorded = await supabase.rpc("record_gmail_email_sent", {
    p_draft_id: draftRow.id,
    p_gmail_message_id: gmailResult.id,
  });
  if (recorded.error) {
    return NextResponse.json({
      ok: true,
      state: "accepted",
      messageId: gmailResult.id,
      warning: "Gmail accepted this email, but the app could not update its status. Check Gmail Sent before attempting anything else.",
    });
  }

  await supabase.from("leads").update({ status: "sent" }).eq("id", lead.id).eq("workspace_id", body.workspaceId);
  await supabase.from("lead_activity").insert({
    workspace_id: body.workspaceId,
    lead_id: lead.id,
    actor_id: user.id,
    event_type: "message_sent",
    details: { provider: "gmail", provider_message_id: gmailResult.id, subject: draftRow.subject },
  });

  return NextResponse.json({
    ok: true,
    state: "accepted",
    messageId: gmailResult.id,
    threadId: gmailResult.threadId || null,
    message: "Gmail accepted the message. Check Sent if you need to verify delivery; acceptance does not guarantee the recipient received it.",
  });
}
