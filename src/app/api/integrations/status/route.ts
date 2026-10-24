import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ApolloApiError, getApolloEmailAccounts } from "@/lib/apollo";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const aiKeyConfigured = Boolean(process.env.AI_GATEWAY_API_KEY);
  const aiModel = process.env.AI_DRAFT_MODEL || null;
  const apolloKeyConfigured = Boolean(process.env.APOLLO_API_KEY);
  const sequenceConfigured = Boolean(process.env.APOLLO_SEQUENCE_ID);
  let mailboxCount = 0;
  let defaultMailbox: { id: string; email: string; name?: string | null } | null = null;
  let apolloConnectionError: string | null = null;
  let sequenceActive: boolean | null = null;
  let sequenceName: string | null = null;
  const sequenceTemplatesApproved = process.env.APOLLO_SEQUENCE_READY === "true";

  if (apolloKeyConfigured) {
    try {
      const mailboxes = await getApolloEmailAccounts();
      mailboxCount = mailboxes.length;
      const preferred = mailboxes.find((account) => account.default) || (mailboxes.length === 1 ? mailboxes[0] : null);
      if (preferred?.email) defaultMailbox = { id: preferred.id, email: preferred.email, name: preferred.name };

      if (sequenceConfigured) {
        const sequenceId = process.env.APOLLO_SEQUENCE_ID!;
        const search = await (await import("@/lib/apollo")).apolloRequest<{
          emailer_campaigns?: Array<{ id?: string; name?: string; active?: boolean }>;
        }>("/emailer_campaigns/search?q_name=" + encodeURIComponent("Mazion | AI Automation | B2B Services") + "&per_page=10&page=1");
        const campaign = (search.emailer_campaigns || []).find((item) => item.id === sequenceId);
        if (campaign) {
          sequenceActive = Boolean(campaign.active);
          sequenceName = campaign.name || null;
        }
      }
    } catch (err) {
      apolloConnectionError = err instanceof ApolloApiError && err.status === 401
        ? "Apollo rejected the API key. Check the key in Vercel environment variables."
        : "Apollo is configured but its mailbox or sequence status could not be loaded.";
    }
  }

  return NextResponse.json({
    ai: {
      keyConfigured: aiKeyConfigured,
      modelConfigured: Boolean(aiModel),
      model: aiModel,
      ready: aiKeyConfigured && Boolean(aiModel),
    },
    apollo: {
      apiKeyConfigured: apolloKeyConfigured,
      mailboxCount,
      defaultMailbox,
      sequenceConfigured,
      sequenceActive,
      sequenceName,
      sequenceTemplatesApproved,
      canActivateSequence: apolloKeyConfigured && mailboxCount > 0 && sequenceConfigured && sequenceTemplatesApproved && sequenceActive === false,
      liveSendReady: apolloKeyConfigured && mailboxCount > 0,
      sequenceReadyForEnrollment: apolloKeyConfigured && mailboxCount > 0 && sequenceConfigured && sequenceTemplatesApproved && sequenceActive === true,
      connectionError: apolloConnectionError,
    },
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}
