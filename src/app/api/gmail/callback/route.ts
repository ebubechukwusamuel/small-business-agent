import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { encryptToken, googleOAuthConfigured, gmailStorageConfigured, googleRedirectUri, siteBaseUrl } from "@/lib/gmail";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const base = siteBaseUrl(request.nextUrl.origin);
  const destination = new URL("/dashboard", base);
  destination.searchParams.set("tab", "settings");
  const params = request.nextUrl.searchParams;
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("gmail_oauth_state")?.value || "";
  const workspaceId = cookieStore.get("gmail_oauth_workspace")?.value || "";
  const receivedState = params.get("state") || "";
  const finish = (status: string) => {
    const url = new URL(destination);
    url.searchParams.set("gmail", status);
    const response = NextResponse.redirect(url);
    response.cookies.delete("gmail_oauth_state");
    response.cookies.delete("gmail_oauth_workspace");
    return response;
  };

  if (params.get("error")) return finish("consent-denied");
  if (!workspaceId || !expectedState || !receivedState || expectedState.length !== receivedState.length ||
      !timingSafeEqual(Buffer.from(expectedState), Buffer.from(receivedState))) return finish("state-error");
  if (!googleOAuthConfigured() || !gmailStorageConfigured()) return finish("setup-required");
  const code = params.get("code");
  if (!code) return finish("missing-code");

  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return finish("login-required");
  const { data: membership } = await supabase.from("workspace_members")
    .select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
  if (!membership || !["owner", "admin"].includes(membership.role)) return finish("not-authorized");

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        code,
        grant_type: "authorization_code",
        redirect_uri: googleRedirectUri(request.url),
      }),
      cache: "no-store",
    });
    const token = await tokenResponse.json() as {
      access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error_description?: string;
    };
    if (!tokenResponse.ok || !token.access_token) throw new Error(token.error_description || "Google token exchange failed.");

    const infoResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { authorization: "Bearer " + token.access_token },
      cache: "no-store",
    });
    const info = await infoResponse.json() as { sub?: string; email?: string; email_verified?: boolean };
    if (!infoResponse.ok || !info.email || !info.sub || info.email_verified !== true) throw new Error("Google did not return a verified email address.");

    const scopes = (token.scope || "").split(/\s+/).filter(Boolean);
    if (!scopes.includes("https://www.googleapis.com/auth/gmail.send")) throw new Error("Gmail send permission was not granted.");
    const { data: existing } = await supabase.from("email_connections")
      .select("id,encrypted_refresh_token")
      .eq("workspace_id", workspaceId).eq("provider", "gmail").eq("provider_email", info.email).maybeSingle();
    const refreshToken = token.refresh_token
      ? encryptToken(token.refresh_token)
      : existing?.encrypted_refresh_token;
    if (!refreshToken) throw new Error("Google didn't provide an offline refresh token. Disconnect this mailbox in Google Account permissions, then connect again.");

    const payload = {
      workspace_id: workspaceId,
      provider: "gmail",
      provider_email: info.email,
      google_subject: info.sub,
      encrypted_access_token: encryptToken(token.access_token),
      encrypted_refresh_token: refreshToken,
      scopes,
      expires_at: new Date(Date.now() + (token.expires_in || 3600) * 1000).toISOString(),
      is_default: true,
      connected_by: user.id,
      last_sync_error: null,
    };
    const upsert = await supabase.from("email_connections").upsert(payload, { onConflict: "workspace_id,provider,provider_email" });
    if (upsert.error) throw new Error("Gmail connected with Google, but secure workspace storage failed. " + upsert.error.message);

    const clearDefaults = await supabase.from("email_connections").update({ is_default: false })
      .eq("workspace_id", workspaceId).eq("provider", "gmail").neq("provider_email", info.email);
    if (clearDefaults.error) throw new Error("Gmail was saved, but the default mailbox setting could not be updated.");

    return finish("connected");
  } catch {
    return finish("connection-failed");
  }
}
