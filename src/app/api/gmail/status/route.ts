import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { gmailStorageConfigured, googleOAuthConfigured, getWorkspaceGmailConnection } from "@/lib/gmail";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "A workspace is required." }, { status: 400 });

  const { data: member } = await supabase.from("workspace_members").select("role")
    .eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
  if (!member || !["owner", "admin"].includes(member.role)) return NextResponse.json({ error: "Only workspace owners or admins can view email settings." }, { status: 403 });

  const { data: profile } = await supabase.from("business_profiles").select("email_history_consent")
    .eq("workspace_id", workspaceId).maybeSingle();
  const configured = googleOAuthConfigured() && gmailStorageConfigured();
  try {
    const connection = configured ? await getWorkspaceGmailConnection(supabase, workspaceId) : null;
    const scopes = connection?.scopes || [];
    return NextResponse.json({
      configured,
      googleOAuthConfigured: googleOAuthConfigured(),
      tokenEncryptionConfigured: gmailStorageConfigured(),
      connected: Boolean(connection),
      email: connection?.provider_email || null,
      scopes,
      connectedAt: connection?.created_at || null,
      sendReady: Boolean(connection && scopes.includes("https://www.googleapis.com/auth/gmail.send")),
      historyReady: Boolean(connection && scopes.includes("https://www.googleapis.com/auth/gmail.readonly")),
      historyConsent: Boolean(profile?.email_history_consent),
      setupMessage: configured ? null : "The app owner must configure Google OAuth Client ID, Google OAuth Client Secret, and the Gmail token encryption key in Vercel.",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ configured, connected: false, email: null, error: "Gmail connection status could not be loaded." }, { status: 503 });
  }
}
