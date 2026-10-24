export type ApolloEmailAccount = {
  id: string;
  email: string;
  default?: boolean;
  name?: string | null;
  active?: boolean;
  revoked_at?: string | null;
}; 

export type ApolloSequence = {
  id: string;
  name: string;
  active: boolean;
  num_steps?: number;
  unique_scheduled?: number;
  contact_statuses?: { active?: number; paused?: number; finished?: number; failed?: number };
};

export class ApolloApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApolloApiError";
    this.status = status;
  }
}

export async function apolloRequest<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) throw new ApolloApiError("Apollo API key is not configured on the server.", 503);

  const response = await fetch("https://api.apollo.io/api/v1" + (path.startsWith("/") ? path : "/" + path), {
    ...init,
    cache: "no-store",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-api-key": apiKey,
      ...(init.headers || {}),
    },
  });

  const raw = await response.text();
  let data: unknown = {};
  if (raw) {
    try { data = JSON.parse(raw); }
    catch { data = { message: raw.slice(0, 500) }; }
  }

  if (!response.ok) {
    const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
    const message = typeof record.message === "string"
      ? record.message
      : typeof record.error === "string"
        ? record.error
        : "Apollo API request failed.";
    throw new ApolloApiError(message, response.status);
  }

  return data as T;
}

export async function getApolloEmailAccounts(): Promise<ApolloEmailAccount[]> {
  const result = await apolloRequest<{ email_accounts?: ApolloEmailAccount[]; emailAccounts?: ApolloEmailAccount[] }>(
    "/email_accounts",
  );
  return Array.isArray(result.email_accounts)
    ? result.email_accounts
    : Array.isArray(result.emailAccounts)
      ? result.emailAccounts
      : [];
}


export async function getApolloSequence(sequenceId: string): Promise<ApolloSequence | null> {
  const result = await apolloRequest<{ emailer_campaigns?: ApolloSequence[] }>(
    "/emailer_campaigns/search",
    {
      method: "POST",
      body: JSON.stringify({
        q_name: "Mazion | AI Automation | B2B Services",
        per_page: 10,
        page: 1,
      }),
    },
  );
  return (result.emailer_campaigns || []).find((sequence) => sequence.id === sequenceId) || null;
}
