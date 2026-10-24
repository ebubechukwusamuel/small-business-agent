import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type GmailConnection = {
  user_id: string;
  email: string;
  scopes: string[];
  refresh_token_ciphertext: string;
  connected_at: string;
  updated_at: string;
};

export function googleOAuthConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function gmailStorageConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.GMAIL_TOKEN_ENCRYPTION_KEY
  );
}

export function createAdminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Private Supabase server credentials are not configured.");
  return createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

export function googleRedirectUri(requestUrl?: string) {
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

export function encryptRefreshToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map(part => part.toString("base64url")).join(".");
}

export function decryptRefreshToken(encrypted: string): string {
  const [ivText, tagText, cipherText] = encrypted.split(".");
  if (!ivText || !tagText || !cipherText) throw new Error("Stored Gmail token is malformed.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(cipherText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export async function getStoredGmailConnection(userId: string): Promise<GmailConnection | null> {
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("gmail_connections")
    .select("user_id,email,scopes,refresh_token_ciphertext,connected_at,updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("Could not read the Gmail connection.");
  return data as GmailConnection | null;
}

export async function getGmailAccessToken(userId: string): Promise<{ accessToken: string; email: string }> {
  const connection = await getStoredGmailConnection(userId);
  if (!connection) throw new Error("Connect Gmail in Settings to read previous emails or send approved drafts.");
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    throw new Error("Google OAuth has not been configured for this deployment.");
  }

  const refreshToken = decryptRefreshToken(connection.refresh_token_ciphertext);
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  const token = await tokenResponse.json() as { access_token?: string; error?: string };
  if (!tokenResponse.ok || !token.access_token) {
    throw new Error("Google could not refresh the connected Gmail session. Reconnect Gmail in Settings.");
  }
  return { accessToken: token.access_token, email: connection.email };
}

async function gmailApi<T>(accessToken: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me" + path, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Gmail access was refused. Reconnect Gmail and check the requested permissions.");
    }
    throw new Error("Gmail API request failed with status " + response.status + ".");
  }
  return await response.json() as T;
}

type GmailHeader = { name?: string; value?: string };
type GmailMessage = {
  id: string;
  threadId?: string;
  internalDate?: string;
  snippet?: string;
  payload?: {
    headers?: GmailHeader[];
    body?: { data?: string };
    parts?: Array<{ mimeType?: string; body?: { data?: string }; parts?: Array<unknown> }>;
  };
};

function decodeBody(value?: string): string {
  if (!value) return "";
  try { return Buffer.from(value, "base64url").toString("utf8"); }
  catch { return ""; }
}

function findPlainText(payload: GmailMessage["payload"]): string {
  if (!payload) return "";
  if (payload.body?.data) return decodeBody(payload.body.data);
  for (const part of payload.parts || []) {
    const nested = part as GmailMessage["payload"];
    const found = findPlainText(nested);
    if (found) return found;
  }
  return "";
}

function header(message: GmailMessage, name: string): string {
  return message.payload?.headers?.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

export type PriorEmail = {
  date: string;
  from: string;
  to: string;
  subject: string;
  direction: "sent" | "received" | "unknown";
  snippet: string;
  body: string;
  threadId: string | null;
};

export async function getRecentGmailConversation(userId: string, leadEmail: string): Promise<PriorEmail[]> {
  const normalized = leadEmail.trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) return [];
  const { accessToken, email: senderEmail } = await getGmailAccessToken(userId);
  const q = "{from:" + normalized + " to:" + normalized + "}";
  const list = await gmailApi<{ messages?: Array<{ id: string; threadId?: string }> }>(
    accessToken,
    "/messages?q=" + encodeURIComponent(q) + "&maxResults=6",
  );
  const refs = (list.messages || []).slice(0, 6);
  const rows = await Promise.all(refs.map(async (ref) => {
    const message = await gmailApi<GmailMessage>(
      accessToken,
      "/messages/" + encodeURIComponent(ref.id) + "?format=full",
    );
    const from = header(message, "From");
    const to = header(message, "To");
    const subject = header(message, "Subject");
    const dateHeader = header(message, "Date");
    const direction = from.toLowerCase().includes(senderEmail.toLowerCase())
      ? "sent"
      : from.toLowerCase().includes(normalized)
        ? "received"
        : "unknown";
    let body = findPlainText(message.payload).replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!body) body = message.snippet || "";
    return {
      date: dateHeader || (message.internalDate ? new Date(Number(message.internalDate)).toISOString() : ""),
      from, to, subject, direction,
      snippet: (message.snippet || "").slice(0, 500),
      body: body.slice(0, 1800),
      threadId: message.threadId || ref.threadId || null,
    } satisfies PriorEmail;
  }));
  return rows;
}

export async function getGmailMessageThreadId(userId: string, leadEmail: string): Promise<string | null> {
  const emails = await getRecentGmailConversation(userId, leadEmail);
  return emails[0]?.threadId || null;
}

export function encodeMimeAsBase64Url(message: string): string {
  return Buffer.from(message, "utf8").toString("base64url");
}

export async function sendGmailMessage(
  userId: string,
  input: { to: string; subject: string; body: string; threadId?: string | null },
): Promise<{ id: string; threadId?: string }> {
  const { accessToken, email } = await getGmailAccessToken(userId);
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
    body: JSON.stringify({
      raw: encodeMimeAsBase64Url(mime),
      ...(input.threadId ? { threadId: input.threadId } : {}),
    }),
  });
  if (!result.id) throw new Error("Gmail did not return a message ID.");
  return result;
}

export async function getGmailProfile(accessToken: string): Promise<{ emailAddress?: string }> {
  return gmailApi<{ emailAddress?: string }>(accessToken, "/profile");
}
