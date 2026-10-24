import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { gmailStorageConfigured, getStoredGmailConnection, googleOAuthConfigured } from "@/lib/gmail";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

  const configured = googleOAuthConfigured() && gmailStorageConfigured();
  if (!configured) {
    return NextResponse.json({
      configured: false,
      connected: false,
      email: null,
      reason: "Google OAuth credentials and private token storage must be configured by the app owner.",
    }, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    const connection = await getStoredGmailConnection(user.id);
    return NextResponse.json({
      configured: true,
      connected: Boolean(connection),
      email: connection?.email || null,
      scopes: connection?.scopes || [],
      connectedAt: connection?.connected_at || null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ configured: false, connected: false, email: null, reason: "Gmail connection status could not be read." }, { status: 503 });
  }
}
