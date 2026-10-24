import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ApolloApiError, getApolloEmailAccounts, getApolloSequence, apolloRequest } from "@/lib/apollo";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

  let body: { workspaceId?: string; confirmed?: boolean };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }

  if (!body.workspaceId) {
    return NextResponse.json({ error: "A workspace is required." }, { status: 400 });
  }
  if (body.confirmed !== true) {
    return NextResponse.json({ error: "Explicit confirmation is required before activating a live outreach sequence." }, { status: 400 });
  }

  const { data: member, error: memberError } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", body.workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (memberError || !member || !["owner", "admin"].includes(member.role)) {
    return NextResponse.json({ error: "Only workspace owners or admins can activate outreach." }, { status: 403 });
  }

  const sequenceId = process.env.APOLLO_SEQUENCE_ID;
  if (!process.env.APOLLO_API_KEY || !sequenceId) {
    return NextResponse.json({ error: "Apollo API key and sequence reference must be configured in Vercel." }, { status: 503 });
  }
  if (process.env.APOLLO_SEQUENCE_READY !== "true") {
    return NextResponse.json({ error: "The Apollo sequence is not marked ready. Review and approve all four email templates in Apollo first, then set APOLLO_SEQUENCE_READY=true in Vercel." }, { status: 409 });
  }

  try {
    const mailboxes = await getApolloEmailAccounts();
    const sender = mailboxes.find((mailbox) => mailbox.default && mailbox.active !== false && !mailbox.revoked_at)
      || (mailboxes.length === 1 && mailboxes[0].active !== false && !mailboxes[0].revoked_at ? mailboxes[0] : null);
    if (!sender) {
      return NextResponse.json({ error: "Connect an active sending mailbox in Apollo and set a default sender before activation." }, { status: 409 });
    }

    const sequence = await getApolloSequence(sequenceId);
    if (!sequence) return NextResponse.json({ error: "The configured Apollo sequence could not be found." }, { status: 404 });
    if (sequence.active) return NextResponse.json({ ok: true, active: true, name: sequence.name, message: "The outreach sequence is already active." });
    if (!sequence.num_steps) return NextResponse.json({ error: "The Apollo sequence has no steps and cannot be activated." }, { status: 409 });

    await apolloRequest(
      "/emailer_campaigns/" + encodeURIComponent(sequenceId) + "/approve",
      { method: "POST", body: JSON.stringify({}) },
    );
    const refreshed = await getApolloSequence(sequenceId);
    return NextResponse.json({
      ok: true,
      active: Boolean(refreshed?.active),
      name: refreshed?.name || sequence.name,
      sender: sender.email,
      message: refreshed?.active
        ? "Apollo confirms the outreach sequence is active."
        : "Apollo accepted activation, but the sequence is not yet reporting as active. Refresh Settings and check Apollo.",
    });
  } catch (err) {
    const status = err instanceof ApolloApiError ? err.status : 502;
    return NextResponse.json({
      error: err instanceof Error ? err.message : "Apollo sequence activation failed.",
    }, { status: status >= 400 && status < 600 ? status : 502 });
  }
}
