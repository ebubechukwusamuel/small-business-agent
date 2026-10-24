export type ApolloEmailAccount = {
  id: string;
  email: string;
  default?: boolean;
  name?: string | null;
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
