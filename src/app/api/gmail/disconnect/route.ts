import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decryptToken } from "@/lib/gmail";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  let body: { workspaceId?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (!body.workspaceId) return NextResponse.json({ error: "A workspace is required." }, { status: 400 });

  const { data: member } = await supabase.from("workspace_members").select("role")
    .eq("workspace_id", body.workspaceId).eq("user_id", user.id).maybeSingle();
  if (!member || !["owner","admin"].includes(member.role)) return NextResponse.json({ error: "Only workspace owners/admins can disconnect Gmail." }, { status: 403 });

  const connection = await supabase.from("email_connections")
    .select("id,encrypted_refresh_token")
    .eq("workspace_id", body.workspaceId).eq("provider","gmail").maybeSingle();
  if (connection.error) return NextResponse.json({ error: "Could not load the Gmail connection." }, { status: 502 });

  if (connection.data?.encrypted_refresh_token) {
    try {
      const token = decryptToken(connection.data.encrypted_refresh_token);
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
        cache: "no-store",
      });
    } catch {
      // Local credentials must still be deleted if Google's revoke endpoint is unavailable.
    }
  }
  if (connection.data?.id) {
    const del = await supabase.from("email_connections").delete().eq("id", connection.data.id).eq("workspace_id", body.workspaceId);
    if (del.error) return NextResponse.json({ error: "Could not remove Gmail credentials from this workspace." }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
