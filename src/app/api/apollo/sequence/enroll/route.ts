import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ApolloApiError, apolloRequest, getApolloEmailAccounts, getApolloSequence } from "@/lib/apollo";

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

function isDemoEmail(value: string) {
  const email = value.trim().toLowerCase();
  return /\.(example|test|invalid)$/.test(email.split("@")[1] || "")
    || /@example\.(com|org|net)$/.test(email);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

  let body: { workspaceId?: string; leadId?: string; confirmed?: boolean };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }

  if (!body.workspaceId || !body.leadId) {
    return NextResponse.json({ error: "A lead and workspace are required." }, { status: 400 });
  }
  if (body.confirmed !== true) {
    return NextResponse.json({ error: "Explicit confirmation is required before enrolling a lead in live outreach." }, { status: 400 });
  }

  const { data: member, error: memberError } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", body.workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (memberError || !member || !["owner", "admin"].includes(member.role)) {
    return NextResponse.json({ error: "Only workspace owners or admins can enroll leads in outreach." }, { status: 403 });
  }

  const sequenceId = process.env.APOLLO_SEQUENCE_ID;
  if (!process.env.APOLLO_API_KEY || !sequenceId) {
    return NextResponse.json({ error: "Apollo API key and sequence reference must be configured in Vercel." }, { status: 503 });
  }
  if (process.env.APOLLO_SEQUENCE_READY !== "true") {
    return NextResponse.json({ error: "The Apollo sequence is not marked ready. Review and approve all four email templates in Apollo first." }, { status: 409 });
  }

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id,workspace_id,company_name,contact_name,email,website,linkedin_url")
    .eq("id", body.leadId)
    .eq("workspace_id", body.workspaceId)
    .maybeSingle();
  if (leadError || !lead) return NextResponse.json({ error: "Lead not found in this workspace." }, { status: 404 });
  const leadRow = lead as LeadRow;
  if (!leadRow.email) return NextResponse.json({ error: "Add an email address before enrolling this lead." }, { status: 400 });
  if (isDemoEmail(leadRow.email)) {
    return NextResponse.json({ error: "Sending to fictional demo addresses is blocked. Replace the .example address with a real, permitted recipient first." }, { status: 400 });
  }

  try {
    const sequence = await getApolloSequence(sequenceId);
    if (!sequence) return NextResponse.json({ error: "The configured Apollo sequence could not be found." }, { status: 404 });
    if (!sequence.active) return NextResponse.json({ error: "The sequence is still inactive. Review and activate it from Settings before enrolling contacts." }, { status: 409 });

    const mailboxes = await getApolloEmailAccounts();
    const sender = mailboxes.find((mailbox) => mailbox.default && mailbox.active !== false && !mailbox.revoked_at)
      || (mailboxes.length === 1 && mailboxes[0].active !== false && !mailboxes[0].revoked_at ? mailboxes[0] : null);
    if (!sender) return NextResponse.json({ error: "Connect an active sending mailbox in Apollo and set a default sender first." }, { status: 409 });

    const existing = await supabase
      .from("lead_activity")
      .select("id")
      .eq("workspace_id", body.workspaceId)
      .eq("lead_id", leadRow.id)
      .eq("event_type", "lead_updated")
      .contains("details", { sequence_id: sequenceId, sequence_status: "enrolled" })
      .limit(1)
      .maybeSingle();
    if (existing.data) {
      return NextResponse.json({ error: "This lead is already recorded as enrolled in this sequence." }, { status: 409 });
    }

    const lookup = await apolloRequest<{ contacts?: Array<{ id: string; email?: string | null; contact_campaign_statuses?: Array<{ emailer_campaign_id?: string; status?: string }> }> }>(
      "/contacts/search",
      { method: "POST", body: JSON.stringify({ q_keywords: leadRow.email.trim().toLowerCase(), per_page: 10, page: 1 }) },
    );
    const contactMatch = (lookup.contacts || []).find((contact) => contact.email?.trim().toLowerCase() === leadRow.email!.trim().toLowerCase());
    let apolloContactId = contactMatch?.id;
    if (contactMatch?.contact_campaign_statuses?.some((status) => status.emailer_campaign_id === sequenceId && ["active", "paused"].includes(status.status || ""))) {
      return NextResponse.json({ error: "Apollo already has this contact in the selected sequence. Refresh Apollo before retrying." }, { status: 409 });
    }

    if (!apolloContactId) {
      const parts = (leadRow.contact_name || "").trim().split(/\s+/).filter(Boolean);
      const payload: Record<string, unknown> = {
        email: leadRow.email.trim().toLowerCase(),
        run_dedupe: false,
      };
      if (parts[0]) payload.first_name = parts[0];
      if (parts.length > 1) payload.last_name = parts.slice(1).join(" ");
      if (leadRow.company_name) payload.organization_name = leadRow.company_name;
      if (leadRow.website) payload.website_url = leadRow.website;
      if (leadRow.linkedin_url) payload.linkedin_url = leadRow.linkedin_url;

      const created = await apolloRequest<{ contact?: { id?: string }; id?: string }>("/contacts", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      apolloContactId = created.contact?.id || created.id;
    }
    if (!apolloContactId) return NextResponse.json({ error: "Apollo did not return a contact id." }, { status: 502 });

    const query = new URLSearchParams();
    query.set("emailer_campaign_id", sequenceId);
    query.append("contact_ids[]", apolloContactId);
    query.set("send_email_from_email_account_id", sender.id);
    query.set("status", "active");
    query.set("sequence_unverified_email", "false");
    query.set("sequence_active_in_other_campaigns", "false");
    query.set("contact_verification_skipped", "false");

    const added = await apolloRequest<{
      contacts?: Array<{ id?: string; email?: string; status?: string }>;
      skipped_contact_ids?: Record<string, string>;
      emailer_campaign?: { name?: string; active?: boolean };
    }>(
      "/emailer_campaigns/" + encodeURIComponent(sequenceId) + "/add_contact_ids?" + query.toString(),
      { method: "POST", body: JSON.stringify({}) },
    );

    if (!(added.contacts || []).some((contact) => contact.id === apolloContactId)) {
      const reason = added.skipped_contact_ids?.[apolloContactId];
      return NextResponse.json({
        error: reason
          ? "Apollo did not enroll this contact: " + reason.replaceAll("_", " ") + "."
          : "Apollo did not confirm that this contact was enrolled. Check Apollo before retrying.",
      }, { status: 409 });
    }

    const { error: activityError } = await supabase.from("lead_activity").insert({
      workspace_id: body.workspaceId,
      lead_id: leadRow.id,
      actor_id: user.id,
      event_type: "lead_updated",
      details: {
        company_name: leadRow.company_name,
        summary: "Enrolled in Apollo outreach sequence",
        sequence_id: sequenceId,
        sequence_name: sequence.name,
        sequence_status: "enrolled",
        apollo_contact_id: apolloContactId,
        sender_email: sender.email,
      },
    });
    if (activityError) {
      return NextResponse.json({
        ok: true,
        enrolled: true,
        sequenceName: sequence.name,
        sender: sender.email,
        warning: "Apollo confirmed enrollment, but the app could not record the activity. Refresh Apollo before retrying.",
      });
    }

    return NextResponse.json({
      ok: true,
      enrolled: true,
      sequenceName: sequence.name,
      sender: sender.email,
      message: "Lead enrolled. Apollo will manage the first send and later steps according to the sequence schedule and reply rules.",
    });
  } catch (err) {
    const status = err instanceof ApolloApiError ? err.status : 502;
    return NextResponse.json({
      error: err instanceof Error ? err.message : "Apollo sequence enrollment failed.",
    }, { status: status >= 400 && status < 600 ? status : 502 });
  }
}
