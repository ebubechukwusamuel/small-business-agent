import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGmailAccessToken, gmailApi, GmailMessage, findPlainText, headerValue } from "@/lib/gmail";

export const dynamic = "force-dynamic";

type GmailListItem = { id: string; threadId?: string };

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

  let body: { workspaceId?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (!body.workspaceId) return NextResponse.json({ error: "A workspace is required." }, { status: 400 });

  const { data: member } = await supabase.from("workspace_members").select("role")
    .eq("workspace_id", body.workspaceId).eq("user_id", user.id).maybeSingle();
  if (!member || !["owner","admin"].includes(member.role)) {
    return NextResponse.json({ error: "Only workspace owners/admins can sync email history." }, { status: 403 });
  }

  const { data: profile } = await supabase.from("business_profiles")
    .select("email_history_consent")
    .eq("workspace_id", body.workspaceId).maybeSingle();
  if (!profile?.email_history_consent) {
    return NextResponse.json({ error: "First enable email-history permission in Business Profile settings." }, { status: 403 });
  }

  try {
    const { accessToken, email: senderEmail, connection } = await getGmailAccessToken(supabase, body.workspaceId);
    if (!(connection.scopes || []).includes("https://www.googleapis.com/auth/gmail.readonly")) {
      return NextResponse.json({ error: "Reconnect Gmail after enabling email-history permission to grant read access." }, { status: 409 });
    }
    const { data: leads, error: leadsError } = await supabase.from("leads")
      .select("id,email")
      .eq("workspace_id", body.workspaceId)
      .not("email","is",null)
      .order("created_at",{ascending:false})
      .limit(25);
    if (leadsError) return NextResponse.json({ error: "Couldn't load leads for email-history matching." }, { status: 500 });

    let saved = 0;
    let examined = 0;
    for (const lead of leads || []) {
      const leadEmail = lead.email?.trim().toLowerCase();
      if (!leadEmail || !leadEmail.includes("@") || /\.(example|test|invalid)$/i.test(leadEmail.split("@")[1] || "")) continue;
      const query = "{from:" + leadEmail + " to:" + leadEmail + "}";
      const list = await gmailApi<{ messages?: GmailListItem[] }>(
        accessToken,
        "/messages?q=" + encodeURIComponent(query) + "&maxResults=5",
      );
      for (const ref of (list.messages || []).slice(0,5)) {
        examined++;
        const message = await gmailApi<GmailMessage>(accessToken, "/messages/" + encodeURIComponent(ref.id) + "?format=full");
        const from = headerValue(message,"From");
        const to = headerValue(message,"To");
        const direction = from.toLowerCase().includes(senderEmail.toLowerCase()) ? "outbound" : from.toLowerCase().includes(leadEmail) ? "inbound" : "unknown";
        const bodyText = findPlainText(message.payload).replace(/\s+/g," ").trim().slice(0,8000);
        const dateHeader = headerValue(message,"Date");
        const messageDate = dateHeader ? new Date(dateHeader) : message.internalDate ? new Date(Number(message.internalDate)) : null;
        const row = {
          workspace_id: body.workspaceId,
          connection_id: connection.id,
          lead_id: lead.id,
          provider: "gmail",
          provider_message_id: message.id,
          provider_thread_id: message.threadId || ref.threadId || message.id,
          direction,
          subject: headerValue(message,"Subject").slice(0,998),
          from_email: from.slice(0,500),
          to_emails: to.split(",").map(s=>s.trim()).filter(Boolean).slice(0,20),
          body_text: bodyText,
          message_date: messageDate && Number.isFinite(messageDate.getTime()) ? messageDate.toISOString() : null,
          fetched_at: new Date().toISOString(),
        };
        const write = await supabase.from("email_history").upsert(row,{onConflict:"workspace_id,connection_id,provider_message_id"});
        if (write.error) {
          await supabase.from("email_connections").update({last_sync_error:"Some messages could not be saved during sync."}).eq("id",connection.id);
          return NextResponse.json({error:"Email history sync stopped while saving matched messages. " + write.error.message,saved,examined},{status:502});
        }
        saved++;
      }
    }

    await supabase.from("email_connections").update({
      last_history_sync_at:new Date().toISOString(),
      last_sync_error:null,
    }).eq("id",connection.id);
    return NextResponse.json({
      ok:true,
      leadsChecked:(leads||[]).length,
      messagesExamined:examined,
      messagesSaved:saved,
      message:"Saved only messages that matched the lead email addresses in this workspace."
    });
  } catch (e) {
    return NextResponse.json({
      error:e instanceof Error ? e.message : "Email history sync failed."
    },{status:502});
  }
}
