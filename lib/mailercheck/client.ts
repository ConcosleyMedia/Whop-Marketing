const BASE_URL = "https://app.mailercheck.com/api";

export class MailerCheckError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = "MailerCheckError";
  }
}

function getAuthHeaders(): HeadersInit {
  const key = process.env.MAILERCHECK_API_KEY;
  if (!key) throw new Error("Missing MAILERCHECK_API_KEY env var");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: getAuthHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new MailerCheckError(`MailerCheck ${method} ${path} → ${res.status}`, res.status, text);
  }
  return (text ? JSON.parse(text) : ({} as T)) as T;
}

export type VerifySingleResponse = {
  status: string;
  result?: string;
  email?: string;
  disposable?: boolean;
  free?: boolean;
  role?: boolean;
  catch_all?: boolean;
  mx_check?: boolean;
  suggestion?: string | null;
  [k: string]: unknown;
};

export async function verifyEmail(email: string): Promise<VerifySingleResponse> {
  return call<VerifySingleResponse>("POST", "/check/single", { email });
}

export type CreateListResponse = { id: number; name: string; status?: string; [k: string]: unknown };

export async function createList(name: string, emails: string[]): Promise<CreateListResponse> {
  return call<CreateListResponse>("POST", "/lists", { name, emails });
}

export async function startListVerification(listId: number): Promise<void> {
  await call<unknown>("PUT", `/lists/${listId}/verify`, {});
}

export type ListStatusResponse = {
  id: number;
  status: string;
  total?: number;
  verified?: number;
  [k: string]: unknown;
};

export async function getListStatus(listId: number): Promise<ListStatusResponse> {
  return call<ListStatusResponse>("GET", `/lists/${listId}`);
}

export type ListResultItem = {
  email: string;
  status: string;
  result?: string;
  [k: string]: unknown;
};

export type ListResultsResponse = {
  data: ListResultItem[];
  meta?: { current_page?: number; last_page?: number; total?: number };
  links?: { next?: string | null };
};

export async function getListResults(
  listId: number,
  page = 1,
  perPage = 500,
): Promise<ListResultsResponse> {
  return call<ListResultsResponse>(
    "GET",
    `/lists/${listId}/results?page=${page}&per_page=${perPage}`,
  );
}

export async function waitForListComplete(
  listId: number,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<ListStatusResponse> {
  const intervalMs = opts.intervalMs ?? 5000;
  const timeoutMs = opts.timeoutMs ?? 240000;
  const start = Date.now();
  while (true) {
    const s = await getListStatus(listId);
    if (s.status !== "processing" && s.status !== "queued" && s.status !== "pending") return s;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`list ${listId} did not complete within ${timeoutMs}ms (last status: ${s.status})`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
