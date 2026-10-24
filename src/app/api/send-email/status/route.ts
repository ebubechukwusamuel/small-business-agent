import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ApolloApiError, apolloRequest } from "@/lib/apollo";

export const dynamic = "force-dynamic";

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
    return NextResponse.json({ error: "Only workspace owners or admins can refresh send status." }, { status: 403 });
  }

  const { data: draft, error: draftError } = await supabase
    .from("follow_up_drafts")
    .select("id,workspace_id,lead_id,status,send_provider,provider_message_id,subject")
    .eq("id", body.draftId)
    .eq("workspace_id", body.workspaceId)
    .maybeSingle();
  if (draftError || !draft) return NextResponse.json({ error: "Draft not found." }, { status: 404 });
  if (draft.status === "sent") return NextResponse.json({ ok: true, state: "delivered" });
  if (draft.send_provider !== "apollo" || !draft.provider_message_id) {
    return NextResponse.json({ error: "There is no Apollo email to check for this draft." }, { status: 409 });
  }

  try {
    const status = await apolloRequest<{ id?: string; status?: string; message?: string; failure_reason?: string; not_sent_reason?: string }>(
      "/emailer_messages/email_send_status",
      { method: "POST", body: JSON.stringify({ id: draft.provider_message_id }) },
    );

    if (status.status === "completed") {
      const marked = await supabase.rpc("record_apollo_email_sent", {
        p_draft_id: draft.id,
        p_provider_message_id: draft.provider_message_id,
      });
      if (marked.error) {
        return NextResponse.json({ error: "Apollo reports delivery, but the app could not update the draft state." }, { status: 502 });
      }
      await supabase.from("leads").update({ status: "sent" }).eq("id", draft.lead_id).eq("workspace_id", body.workspaceId);
      await supabase.from("lead_activity").insert({
        workspace_id: body.workspaceId,
        lead_id: draft.lead_id,
        actor_id: user.id,
        event_type: "message_sent",
        details: { provider: "apollo", provider_message_id: draft.provider_message_id, subject: draft.subject },
      });
      return NextResponse.json({ ok: true, state: "delivered", message: status.message });
    }

    if (status.status === "failed") {
      return NextResponse.json({
        ok: false,
        state: "failed",
        error: status.failure_reason || status.not_sent_reason || status.message || "Apollo failed to send this email.",
      }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      state: "queued",
      message: status.message || "Apollo is still processing this email.",
    }, { status: 202 });
  } catch (err) {
    const code = err instanceof ApolloApiError ? err.status : 502;
    return NextResponse.json({
      error: err instanceof Error ? err.message : "Couldn't retrieve the send status.",
    }, { status: code });
  }
}
