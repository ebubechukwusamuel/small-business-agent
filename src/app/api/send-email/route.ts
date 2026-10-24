import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ApolloApiError, apolloRequest, getApolloEmailAccounts } from "@/lib/apollo";

export const dynamic = "force-dynamic";

type LeadRow = {
  id: string;
  workspace_id: string;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  website: string | null;
  linkedin_url: string | null;
};

type DraftRow = {
  id: string;
  workspace_id: string;
  lead_id: string;
  subject: string;
  body: string;
  status: string;
  approved_by: string | null;
  approved_at: string | null;
  send_provider: string | null;
  provider_message_id: string | null;
};

function safeHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  return "<html><body><p>" + escaped.replace(/\r?\n/g, "<br>") + "</p></body></html>";
}

function blockedDemoEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return normalized.endsWith(".example")
    || normalized.endsWith(".test")
    || normalized.endsWith(".invalid")
    || normalized.endsWith("@example.com")
    || normalized.endsWith("@example.org")
    || normalized.endsWith("@example.net");
}

async function requireWorkspaceManager(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  workspaceId: string,
) {
  const { data, error } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error || !data || !["owner", "admin"].includes(data.role)) return false;
  return true;
}

async function getEmailAccount() {
  const accounts = await getApolloEmailAccounts();
  if (!accounts.length) {
    throw new ApolloApiError(
      "No sending mailbox is connected to Apollo. Connect a Gmail or Microsoft mailbox in Apollo first.",
      409,
    );
  }
  const preferred = accounts.find((account) => account.default);
  if (preferred) return preferred;
  if (accounts.length === 1) return accounts[0];
  throw new ApolloApiError(
    "Apollo has multiple mailboxes but no default sender. Set a default sending mailbox in Apollo.",
    409,
  );
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

  const allowed = await requireWorkspaceManager(supabase, user.id, body.workspaceId);
  if (!allowed) {
    return NextResponse.json({ error: "Only workspace owners or admins can send an approved draft." }, { status: 403 });
  }

  const { data: draft, error: draftError } = await supabase
    .from("follow_up_drafts")
    .select("id,workspace_id,lead_id,subject,body,status,approved_by,approved_at,send_provider,provider_message_id")
    .eq("id", body.draftId)
    .eq("workspace_id", body.workspaceId)
    .maybeSingle();

  if (draftError || !draft) {
    return NextResponse.json({ error: "Draft not found in this workspace." }, { status: 404 });
  }
  const draftRow = draft as DraftRow;
  if (draftRow.status !== "approved" || !draftRow.approved_by || !draftRow.approved_at) {
    return NextResponse.json({ error: "Only a draft that has been approved can be sent." }, { status: 409 });
  }
  if (draftRow.provider_message_id) {
    return NextResponse.json({
      error: "This draft already has an Apollo message associated with it. Refresh its status instead of sending it again.",
      queued: true,
      providerMessageId: draftRow.provider_message_id,
    }, { status: 409 });
  }
  if (!process.env.APOLLO_API_KEY) {
    return NextResponse.json({
      error: "Apollo sending is not connected yet. Add APOLLO_API_KEY to the Vercel project environment after creating an Apollo API key.",
    }, { status: 503 });
  }

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id,workspace_id,company_name,contact_name,email,website,linkedin_url")
    .eq("id", draftRow.lead_id)
    .eq("workspace_id", body.workspaceId)
    .maybeSingle();
  if (leadError || !lead) {
    return NextResponse.json({ error: "The lead connected to this draft could not be found." }, { status: 404 });
  }
  const leadRow = lead as LeadRow;
  if (!leadRow.email) {
    return NextResponse.json({ error: "This lead has no email address. Add an address before sending." }, { status: 400 });
  }
  if (blockedDemoEmail(leadRow.email)) {
    return NextResponse.json({
      error: "Sending is blocked for demo/test addresses. Replace the sample lead with a real, permitted recipient first.",
    }, { status: 400 });
  }

  try {
    await getEmailAccount();

    const parts = (leadRow.contact_name || "").trim().split(/\s+/).filter(Boolean);
    const contactPayload: Record<string, unknown> = {
      email: leadRow.email.trim().toLowerCase(),
      run_dedupe: true,
    };
    if (parts[0]) contactPayload.first_name = parts[0];
    if (parts.length > 1) contactPayload.last_name = parts.slice(1).join(" ");
    if (leadRow.company_name) contactPayload.organization_name = leadRow.company_name;
    if (leadRow.website) contactPayload.website_url = leadRow.website;

    const contactResult = await apolloRequest<{ contact?: { id?: string; email_status?: string }; id?: string }>(
      "/contacts",
      { method: "POST", body: JSON.stringify(contactPayload) },
    );
    const contact = contactResult.contact || contactResult as { id?: string; email_status?: string };
    if (!contact.id) {
      return NextResponse.json({ error: "Apollo did not return a contact id." }, { status: 502 });
    }

    const createdMessage = await apolloRequest<{ emailer_message?: { id?: string; status?: string }; id?: string }>(
      "/emailer_messages",
      {
        method: "POST",
        body: JSON.stringify({
          contact_id: contact.id,
          subject: draftRow.subject,
          body_html: safeHtml(draftRow.body),
        }),
      },
    );
    const message = createdMessage.emailer_message || createdMessage as { id?: string; status?: string };
    if (!message.id) {
      return NextResponse.json({ error: "Apollo did not return a message id; nothing was sent." }, { status: 502 });
    }

    const recorded = await supabase.rpc("record_apollo_email_queued", {
      p_draft_id: draftRow.id,
      p_provider_message_id: message.id,
    });
    if (recorded.error) {
      return NextResponse.json({
        error: "Apollo created a message draft, but the app could not record it. Check Apollo before retrying to avoid a duplicate.",
      }, { status: 502 });
    }

    const sendResult = await apolloRequest<{ emailer_message?: { id?: string; status?: string }; status?: string }>(
      "/emailer_messages/" + encodeURIComponent(message.id) + "/send_now",
      { method: "POST", body: JSON.stringify({ surface: "emails" }) },
    );
    const sendMessage = sendResult.emailer_message || sendResult as { id?: string; status?: string };

    if (sendMessage.status === "failed") {
      return NextResponse.json({
        error: "Apollo refused to send the message. Check the mailbox and contact permissions in Apollo before retrying.",
        state: "failed",
        providerMessageId: message.id,
      }, { status: 502 });
    }

    // Apollo sends asynchronously. The app stores the provider id first, then status can be refreshed.
    const statusResult = await apolloRequest<{ status?: string; message?: string }>(
      "/emailer_messages/email_send_status",
      { method: "POST", body: JSON.stringify({ id: message.id }) },
    );

    if (statusResult.status === "completed") {
      const completed = await supabase.rpc("record_apollo_email_sent", {
        p_draft_id: draftRow.id,
        p_provider_message_id: message.id,
      });
      if (completed.error) {
        return NextResponse.json({
          ok: true,
          state: "delivered",
          providerMessageId: message.id,
          warning: "Apollo reports delivery, but the app could not update the draft record. Refresh the status before retrying.",
        });
      }
      await supabase.from("leads").update({ status: "sent" }).eq("id", leadRow.id).eq("workspace_id", body.workspaceId);
      await supabase.from("lead_activity").insert({
        workspace_id: body.workspaceId,
        lead_id: leadRow.id,
        actor_id: user.id,
        event_type: "message_sent",
        details: { provider: "apollo", provider_message_id: message.id, subject: draftRow.subject },
      });
      return NextResponse.json({ ok: true, state: "delivered", providerMessageId: message.id });
    }

    return NextResponse.json({
      ok: true,
      state: "queued",
      providerMessageId: message.id,
      message: "Apollo accepted the email for processing. Use Refresh status to confirm delivery.",
    }, { status: 202 });
  } catch (err) {
    const status = err instanceof ApolloApiError ? err.status : 502;
    const message = err instanceof Error ? err.message : "Apollo sending failed.";
    return NextResponse.json({
      error: message,
      setupRequired: status === 409 || status === 503,
    }, { status: status >= 400 && status < 600 ? status : 502 });
  }
}
