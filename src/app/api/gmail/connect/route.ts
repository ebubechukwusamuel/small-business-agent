import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { gmailStorageConfigured, googleOAuthConfigured, googleRedirectUri } from "@/lib/gmail";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.redirect(new URL("/login", request.url));

  const base = process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin;
  const settings = new URL("/dashboard", base);
  settings.searchParams.set("tab", "settings");

  if (!googleOAuthConfigured() || !gmailStorageConfigured()) {
    settings.searchParams.set("gmail", "setup-required");
    return NextResponse.redirect(settings);
  }

  const state = randomBytes(32).toString("base64url");
  const query = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: googleRedirectUri(request.url),
    response_type: "code",
    scope: [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
    ].join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  const response = NextResponse.redirect("https://accounts.google.com/o/oauth2/v2/auth?" + query.toString());
  response.cookies.set("gmail_oauth_state", state, {
    httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "lax", maxAge: 600, path: "/",
  });
  return response;
}
