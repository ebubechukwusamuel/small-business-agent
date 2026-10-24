import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { createClient } from "@/lib/supabase/server";

export type GmailConnection = {
  id: string;
  workspace_id: string;
  created_at: string;
  provider: "gmail";
  provider_email: string;
  google_subject: string | null;
  encrypted_access_token: string;
  encrypted_refresh_token: string | null;
  scopes: string[];
  expires_at: string | null;
  is_default: boolean;
  connected_by: string;
  last_history_sync_at: string | null;
  last_sync_error: string | null;
};

export type PriorEmail = {
  date: string;
  from: string;
  to: string;
  subject: string;
  direction: "outbound" | "inbound" | "unknown";
  snippet: string;
  body: string;
  threadId: string | null;
  messageId: string;
};

export function googleOAuthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function gmailStorageConfigured(): boolean {
  if (!process.env.GMAIL_TOKEN_ENCRYPTION_KEY) return false;
  try { encryptionKey(); return true; } catch { return false; }
}

export function googleRedirectUri(requestUrl?: string): string {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const base = process.env.NEXT_PUBLIC_SITE_URL || (requestUrl ? new URL(requestUrl).origin : "");
  if (!base) throw new Error("Set GOOGLE_REDIRECT_URI or NEXT_PUBLIC_SITE_URL.");
  return base.replace(/\/+$/, "") + "/api/gmail/callback";
}

function encryptionKey(): Buffer {
  const value = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
  if (!value) throw new Error("Gmail token encryption key is not configured.");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("GMAIL_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  return key;
}

export function encryptToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptToken(encrypted: string): string {
  const [version, ivText, tagText, cipherText] = encrypted.split(".");
  if (version !== "v1" || !ivText || !tagText || !cipherText) throw new Error("Stored Gmail token is malformed.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(cipherText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function siteBaseUrl(fallback: string): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || fallback).replace(/\/+$/, "");
}

export async function getWorkspaceGmailConnection(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
): Promise<GmailConnection | null> {
  const { data, error } = await supabase
    .from("email_connections")
    .select("id,workspace_id,created_at,provider,provider_email,google_subject,encrypted_access_token,encrypted_refresh_token,scopes,expires_at,is_default,connected_by,last_history_sync_at,last_sync_error")
    .eq("workspace_id", workspaceId)
    .eq("provider", "gmail")
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("Could not read this workspace's Gmail connection.");
  return data as GmailConnection | null;
}

export async function getGmailAccessToken(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
): Promise<{ accessToken: string; email: string; connection: GmailConnection }> {
  if (!gmailStorageConfigured()) throw new Error("Gmail token storage is not configured.");
  const connection = await getWorkspaceGmailConnection(supabase, workspaceId);
  if (!connection) throw new Error("Connect Gmail for this workspace in Settings first.");

  const expiredAt = connection.expires_at ? new Date(connection.expires_at).getTime() : 0;
  let accessToken: string;
  if (expiredAt > Date.now() + 60_000) {
    accessToken = decryptToken(connection.encrypted_access_token);
  } else {
    const refreshToken = connection.encrypted_refresh_token ? decryptToken(connection.encrypted_refresh_token) : null;
    if (!refreshToken) throw new Error("This Gmail connection has no refresh token. Reconnect Gmail in Settings.");
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) throw new Error("Google OAuth isn't configured.");

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
      cache: "no-store",
    });
    const result = await response.json() as { access_token?: string; expires_in?: number; error_description?: string };
    if (!response.ok || !result.access_token) throw new Error(result.error_description || "Google could not refresh the Gmail connection. Reconnect Gmail.");
    accessToken = result.access_token;
    const { error: updateError } = await supabase.from("email_connections").update({
      encrypted_access_token: encryptToken(accessToken),
      expires_at: new Date(Date.now() + (result.expires_in || 3600) * 1000).toISOString(),
      last_sync_error: null,
    }).eq("id", connection.id).eq("workspace_id", workspaceId);
    if (updateError) throw new Error("Could not update the encrypted Gmail session.");
  }
  return { accessToken, email: connection.provider_email, connection };
}

export async function gmailApi<T>(accessToken: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me" + (path.startsWith("/") ? path : "/" + path), {
    ...init,
    cache: "no-store",
    headers: { authorization: "Bearer " + accessToken, ...(init.headers || {}) },
  });
  const raw = await response.text();
  let data: unknown = {};
  if (raw) {
    try { data = JSON.parse(raw); } catch { data = { message: raw.slice(0, 400) }; }
  }
  if (!response.ok) {
    const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
    const error = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : {};
    throw new Error(typeof error.message === "string" ? error.message : typeof record.message === "string" ? record.message : "Gmail API request failed.");
  }
  return data as T;
}

type GmailHeader = { name?: string; value?: string };
export type GmailMessage = {
  id: string;
  threadId?: string;
  internalDate?: string;
  snippet?: string;
  labelIds?: string[];
  payload?: {
    mimeType?: string;
    headers?: GmailHeader[];
    body?: { data?: string };
    parts?: Array<GmailMessage["payload"]>;
  };
};

export function decodeBody(value?: string): string {
  if (!value) return "";
  try { return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"); }
  catch { return ""; }
}

export function findPlainText(payload: GmailMessage["payload"]): string {
  if (!payload) return "";
  const mimeType = payload.mimeType || "";
  if (mimeType === "text/plain" && payload.body?.data) return decodeBody(payload.body.data);
  for (const part of payload.parts || []) {
    const found = findPlainText(part);
    if (found.trim()) return found;
  }
  if (mimeType === "text/html" && payload.body?.data) {
    return decodeBody(payload.body.data)
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/\s+/g, " ").trim();
  }
  return payload.body?.data ? decodeBody(payload.body.data) : "";
}

export function headerValue(message: GmailMessage, name: string): string {
  return message.payload?.headers?.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

export async function getRecentGmailConversation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  leadEmail: string,
): Promise<PriorEmail[]> {
  const { data: profile } = await supabase.from("business_profiles")
    .select("email_history_consent")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!profile?.email_history_consent) return [];

  const normalized = leadEmail.trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) return [];
  const { accessToken, email: senderEmail, connection } = await getGmailAccessToken(supabase, workspaceId);
  if (!(connection.scopes || []).includes("https://www.googleapis.com/auth/gmail.readonly")) return [];

  const query = "{from:" + normalized + " to:" + normalized + "}";
  const list = await gmailApi<{ messages?: Array<{ id: string; threadId?: string }> }>(
    accessToken,
    "/messages?q=" + encodeURIComponent(query) + "&maxResults=6",
  );
  const refs = (list.messages || []).slice(0, 6);
  const rows = await Promise.all(refs.map(async ref => {
    const message = await gmailApi<GmailMessage>(accessToken, "/messages/" + encodeURIComponent(ref.id) + "?format=full");
    const from = headerValue(message, "From");
    const to = headerValue(message, "To");
    const date = headerValue(message, "Date") || (message.internalDate ? new Date(Number(message.internalDate)).toISOString() : "");
    const body = findPlainText(message.payload).replace(/\s+/g, " ").trim();
    return {
      date, from, to, subject: headerValue(message, "Subject"),
      direction: from.toLowerCase().includes(senderEmail.toLowerCase()) ? "outbound" : from.toLowerCase().includes(normalized) ? "inbound" : "unknown",
      snippet: (message.snippet || "").slice(0, 500),
      body: body.slice(0, 1800),
      threadId: message.threadId || ref.threadId || null,
      messageId: message.id,
    } satisfies PriorEmail;
  }));
  return rows;
}

export function encodeMimeAsBase64Url(message: string): string {
  return Buffer.from(message, "utf8").toString("base64url");
}

export async function sendGmailMessage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  input: { to: string; subject: string; body: string; threadId?: string | null },
): Promise<{ id: string; threadId?: string }> {
  const { accessToken, email } = await getGmailAccessToken(supabase, workspaceId);
  const encodeHeader = (value: string) => /[^\x00-\x7F]/.test(value)
    ? "=?UTF-8?B?" + Buffer.from(value, "utf8").toString("base64") + "?="
    : value.replace(/[\r\n]/g, " ");
  const mime = [
    "To: " + input.to.trim(),
    "From: " + email,
    "Subject: " + encodeHeader(input.subject),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(input.body, "utf8").toString("base64"),
  ].join("\r\n");
  const result = await gmailApi<{ id: string; threadId?: string }>(accessToken, "/messages/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ raw: encodeMimeAsBase64Url(mime), ...(input.threadId ? { threadId: input.threadId } : {}) }),
  });
  if (!result.id) throw new Error("Gmail did not return a message ID.");
  return result;
}
