import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { googleOAuthConfigured, gmailStorageConfigured, googleRedirectUri, siteBaseUrl } from "@/lib/gmail";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  const base = siteBaseUrl(request.nextUrl.origin);
  const settings = new URL("/dashboard", base);
  settings.searchParams.set("tab", "settings");

  if (error || !user) return NextResponse.redirect(new URL("/login", base));
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    settings.searchParams.set("gmail", "workspace-required");
    return NextResponse.redirect(settings);
  }
  if (!googleOAuthConfigured() || !gmailStorageConfigured()) {
    settings.searchParams.set("gmail", "setup-required");
    return NextResponse.redirect(settings);
  }

  const { data: membership } = await supabase.from("workspace_members")
    .select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    settings.searchParams.set("gmail", "not-authorized");
    return NextResponse.redirect(settings);
  }

  const { data: businessProfile } = await supabase.from("business_profiles")
    .select("email_history_consent").eq("workspace_id", workspaceId).maybeSingle();
  const state = randomBytes(32).toString("base64url");
  const scopes = ["openid", "email", "profile", "https://www.googleapis.com/auth/gmail.send"];
  if (businessProfile?.email_history_consent) scopes.push("https://www.googleapis.com/auth/gmail.readonly");

  const query = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: googleRedirectUri(request.url),
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  const response = NextResponse.redirect("https://accounts.google.com/o/oauth2/v2/auth?" + query.toString());
  const options = { httpOnly: true, secure: base.startsWith("https://"), sameSite: "lax" as const, maxAge: 600, path: "/" };
  response.cookies.set("gmail_oauth_state", state, options);
  response.cookies.set("gmail_oauth_workspace", workspaceId, options);
  return response;
}
