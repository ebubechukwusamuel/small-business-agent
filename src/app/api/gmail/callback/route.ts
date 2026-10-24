import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  createAdminSupabase,
  encryptRefreshToken,
  gmailStorageConfigured,
  googleOAuthConfigured,
  googleRedirectUri,
} from "@/lib/gmail";

export async function GET(request: NextRequest) {
  const base = process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin;
  const destination = new URL("/dashboard", base);
  destination.searchParams.set("tab", "settings");
  const params = request.nextUrl.searchParams;
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("gmail_oauth_state")?.value || "";
  const receivedState = params.get("state") || "";
  const response = (key: string, value: string) => {
    const url = new URL(destination);
    url.searchParams.set(key, value);
    const result = NextResponse.redirect(url);
    result.cookies.delete("gmail_oauth_state");
    return result;
  };

  if (params.get("error")) return response("gmail", "consent-denied");
  if (!expectedState || !receivedState || expectedState.length !== receivedState.length ||
      !timingSafeEqual(Buffer.from(expectedState), Buffer.from(receivedState))) {
    return response("gmail", "state-error");
  }
  if (!googleOAuthConfigured() || !gmailStorageConfigured()) return response("gmail", "setup-required");

  const code = params.get("code");
  if (!code) return response("gmail", "missing-code");
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return response("gmail", "login-required");

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        code,
        grant_type: "authorization_code",
        redirect_uri: googleRedirectUri(request.url),
      }),
      cache: "no-store",
    });
    const tokenData = await tokenResponse.json() as {
      access_token?: string; refresh_token?: string; scope?: string; error?: string;
    };
    if (!tokenResponse.ok || !tokenData.access_token) return response("gmail", "token-exchange-failed");

    const profileResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: "Bearer " + tokenData.access_token },
      cache: "no-store",
    });
    const profile = await profileResponse.json() as { emailAddress?: string };
    if (!profileResponse.ok || !profile.emailAddress) return response("gmail", "profile-failed");

    const admin = createAdminSupabase();
    let refreshToken = tokenData.refresh_token || "";
    if (!refreshToken) {
      const existing = await admin.from("gmail_connections")
        .select("refresh_token_ciphertext")
        .eq("user_id", user.id)
        .maybeSingle();
      if (existing.error || !existing.data?.refresh_token_ciphertext) {
        return response("gmail", "refresh-token-missing");
      }
      const { decryptRefreshToken } = await import("@/lib/gmail");
      refreshToken = decryptRefreshToken(existing.data.refresh_token_ciphertext);
    }

    const upsert = await admin.from("gmail_connections").upsert({
      user_id: user.id,
      email: profile.emailAddress,
      scopes: (tokenData.scope || "").split(/\s+/).filter(Boolean),
      refresh_token_ciphertext: encryptRefreshToken(refreshToken),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (upsert.error) return response("gmail", "save-failed");
    return response("gmail", "connected");
  } catch {
    return response("gmail", "connection-failed");
  }
}
