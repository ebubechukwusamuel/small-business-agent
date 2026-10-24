import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminSupabase, decryptRefreshToken, gmailStorageConfigured } from "@/lib/gmail";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  if (!gmailStorageConfigured()) return NextResponse.json({ error: "Gmail server storage is not configured." }, { status: 503 });

  const admin = createAdminSupabase();
  const connection = await admin.from("gmail_connections")
    .select("refresh_token_ciphertext")
    .eq("user_id", user.id)
    .maybeSingle();
  if (connection.error) return NextResponse.json({ error: "Could not load your Gmail connection." }, { status: 502 });

  if (connection.data?.refresh_token_ciphertext) {
    try {
      const token = decryptRefreshToken(connection.data.refresh_token_ciphertext);
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
        cache: "no-store",
      });
    } catch {
      // Delete local credentials even if Google's revoke endpoint is temporarily unavailable.
    }
  }

  const deleted = await admin.from("gmail_connections").delete().eq("user_id", user.id);
  if (deleted.error) return NextResponse.json({ error: "Could not disconnect Gmail from this app." }, { status: 502 });
  return NextResponse.json({ ok: true });
}
