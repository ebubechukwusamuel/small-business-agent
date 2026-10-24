import { generateText, Output } from "ai";
import { z } from "zod";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRecentGmailConversation } from "@/lib/gmail";

const DraftOutput = z.object({
  subject: z.string().min(3).max(140),
  body: z.string().min(20).max(5000),
});

export async function POST(request: NextRequest) {
  // AI Gateway authenticates hosted Vercel deployments with OIDC. Local/dev builds can use
  // AI_GATEWAY_API_KEY instead. Never expose either credential to the browser.
  const gatewayAuthConfigured = Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);
  if (!gatewayAuthConfigured || !process.env.AI_DRAFT_MODEL) {
    return NextResponse.json(
      { error: "AI drafting is not configured on this deployment yet. Add a server-side AI Gateway key for non-Vercel environments or verify the deployment's Vercel OIDC identity." },
      { status: 503 },
    );
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

  let body: { leadId?: string; workspaceId?: string; researchId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!body.leadId || !body.workspaceId) {
    return NextResponse.json({ error: "A lead and workspace are required." }, { status: 400 });
  }

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id, company_name, contact_name, email, website, linkedin_url, notes")
    .eq("id", body.leadId)
    .eq("workspace_id", body.workspaceId)
    .maybeSingle();
  if (leadError || !lead) return NextResponse.json({ error: "Lead not found, or you don't have access to it." }, { status: 404 });

  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("id,name,business_profile")
    .eq("id", body.workspaceId)
    .maybeSingle();
  if (workspaceError || !workspace) return NextResponse.json({ error: "Workspace not found, or you don't have access to it." }, { status: 404 });
  const businessProfile = workspace.business_profile && typeof workspace.business_profile === "object"
    ? workspace.business_profile as Record<string, unknown>
    : {};

  let priorEmails: Awaited<ReturnType<typeof getRecentGmailConversation>> = [];
  let emailHistoryAvailable = false;
  if (lead.email) {
    try {
      priorEmails = await getRecentGmailConversation(user.id, lead.email);
      emailHistoryAvailable = true;
    } catch {
      // Lack of a Gmail connection must not break template drafting. The model is told that
      // it has no verified email history and must never claim to be following up on a sent email.
    }
  }

  let researchSummary = "No research notes have been added yet. Do not invent facts about this prospect.";
  if (body.researchId) {
    const { data: research } = await supabase
      .from("lead_research")
      .select("summary, findings, source_urls")
      .eq("id", body.researchId)
      .eq("workspace_id", body.workspaceId)
      .maybeSingle();
    if (research) researchSummary = JSON.stringify({ summary: research.summary, findings: research.findings, sources: research.source_urls });
  } else {
    const { data: research } = await supabase
      .from("lead_research")
      .select("summary, findings, source_urls")
      .eq("lead_id", body.leadId)
      .eq("workspace_id", body.workspaceId)
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (research) researchSummary = JSON.stringify({ summary: research.summary, findings: research.findings, sources: research.source_urls });
  }

  try {
    const { output } = await generateText({
      model: process.env.AI_DRAFT_MODEL,
      maxOutputTokens: 500,
      temperature: 0.3,
      output: Output.object({ schema: DraftOutput }),
      system: "You are the email-writing assistant for a small business. The user's business profile is the source of truth for their offer, audience, differentiators, voice, and preferred call to action. Use it to write in that business's voice. Use only supplied lead details, saved research, and the provided email history. Never invent facts, results, relationships, or prior messages. If email history exists, write a genuine continuation: respond to the latest incoming email when one exists, otherwise write a sensible follow-up that does not repeat a previous message or ask already answered. If no email history is provided, write a first-contact introduction and do not claim an earlier email was sent. Avoid manipulative urgency. No attachments or links unless explicitly supplied. Return a subject and body only.",
      prompt: JSON.stringify({
        business: { workspaceName: workspace.name, profile: businessProfile },
        lead,
        research: researchSummary,
        verifiedEmailHistory: priorEmails.map(({ date, from, to, subject, direction, body, snippet }) => ({ date, from, to, subject, direction, body, snippet })),
        instructions: "Write a personalised email under 150 words. Use the business's preferred writing voice and call to action. Use the contact's first name when appropriate. If history includes an incoming reply, answer it naturally rather than pretending the conversation is cold. Do not state that a message has been sent; this output is only a draft."
      }),
    });
    if (!output) return NextResponse.json({ error: "The model returned no structured draft." }, { status: 502 });
    return NextResponse.json({
      ...output,
      model: process.env.AI_DRAFT_MODEL,
      contextUsed: {
        businessProfile: Object.values(businessProfile).some(value => typeof value === "string" && value.trim().length > 0),
        priorEmails: priorEmails.length,
        emailHistoryAvailable,
      },
    });
  } catch (error) {
    console.error("AI draft generation failed:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Draft generation failed. Check the configured AI Gateway model and account settings." }, { status: 502 });
  }
}
