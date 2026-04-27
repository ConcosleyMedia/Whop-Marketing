const BASE_URL = "https://connect.mailerlite.com/api";

export class MailerLiteError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = "MailerLiteError";
  }
}

function getAuthHeaders(): HeadersInit {
  const key = process.env.MAILERLITE_API_KEY;
  if (!key) throw new Error("Missing MAILERLITE_API_KEY env var");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  retries = 3,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: getAuthHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    if (res.status === 429 && attempt < retries) {
      const retryAfter = parseInt(res.headers.get("retry-after") ?? "5", 10);
      await new Promise((r) => setTimeout(r, Math.min(retryAfter * 1000, 30000)));
      continue;
    }
    const text = await res.text();
    if (!res.ok) {
      throw new MailerLiteError(
        `MailerLite ${method} ${path} → ${res.status}`,
        res.status,
        text,
      );
    }
    return (text ? JSON.parse(text) : ({} as T)) as T;
  }
}

async function getUrl<T>(absoluteUrl: string): Promise<T> {
  const res = await fetch(absoluteUrl, {
    headers: getAuthHeaders(),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new MailerLiteError(`MailerLite GET ${absoluteUrl} → ${res.status}`, res.status, text);
  }
  return (text ? JSON.parse(text) : ({} as T)) as T;
}

export type RateStat = { float: number; string: string };

export type Group = {
  id: string;
  name: string;
  active_count?: number;
  sent_count?: number;
  opens_count?: number;
  open_rate?: RateStat;
  clicks_count?: number;
  click_rate?: RateStat;
  unsubscribed_count?: number;
  unconfirmed_count?: number;
  bounced_count?: number;
  junk_count?: number;
  created_at?: string;
};
export type Field = { id: string; name: string; key: string; type: string };

export type CampaignStats = {
  sent?: number;
  opens_count?: number;
  unique_opens_count?: number;
  open_rate?: RateStat;
  clicks_count?: number;
  unique_clicks_count?: number;
  click_rate?: RateStat;
  unsubscribes_count?: number;
  spam_count?: number;
  hard_bounces_count?: number;
  soft_bounces_count?: number;
  forwards_count?: number;
};

export type CampaignEmailSummary = {
  id?: string;
  subject?: string;
  from?: string;
  from_name?: string;
  preview_text?: string | null;
  content?: string;
  plain_text?: string | null;
};

export type Campaign = {
  id: string;
  name: string;
  type?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  scheduled_for?: string | null;
  queued_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  emails?: CampaignEmailSummary[];
  stats?: CampaignStats;
  is_stopped?: boolean;
  type_for_humans?: string;
  filter_for_humans?: string[] | null;
};

export type Segment = {
  id: string;
  name: string;
  total?: number;
  open_rate?: RateStat;
  click_rate?: RateStat;
  created_at?: string;
};

export type GroupSubscriber = {
  id: string;
  email: string;
  status?: string;
  subscribed_at?: string;
  opens_count?: number;
  clicks_count?: number;
  fields?: Record<string, string | number | null>;
};

export async function listGroups(): Promise<Group[]> {
  const out: Group[] = [];
  let cursor: string | undefined;
  while (true) {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}&limit=100` : "?limit=100";
    const r = await call<{ data: Group[]; meta?: { next_cursor?: string | null } }>(
      "GET",
      `/groups${qs}`,
    );
    out.push(...(r.data ?? []));
    const next = r.meta?.next_cursor;
    if (!next) break;
    cursor = next;
  }
  return out;
}

export async function createGroup(name: string): Promise<Group> {
  const r = await call<{ data: Group }>("POST", "/groups", { name });
  return r.data;
}

export async function findOrCreateGroup(name: string): Promise<Group> {
  const existing = await listGroups();
  const match = existing.find((g) => g.name === name);
  if (match) return match;
  return createGroup(name);
}

export async function listFields(): Promise<Field[]> {
  const out: Field[] = [];
  let page = 1;
  while (true) {
    const r = await call<{ data: Field[]; meta?: { last_page?: number; current_page?: number } }>(
      "GET",
      `/fields?limit=100&page=${page}`,
    );
    out.push(...(r.data ?? []));
    const last = r.meta?.last_page ?? page;
    if (page >= last) break;
    page++;
  }
  return out;
}

export async function createField(
  name: string,
  type: "text" | "number" | "date",
): Promise<Field> {
  const r = await call<{ data: Field }>("POST", "/fields", { name, type });
  return r.data;
}

export async function ensureField(
  existing: Field[],
  name: string,
  type: "text" | "number" | "date",
): Promise<Field> {
  const match = existing.find((f) => f.name === name);
  if (match) return match;
  const created = await createField(name, type);
  existing.push(created);
  return created;
}

export type ImportSubscriber = {
  email: string;
  fields?: Record<string, string | number | null>;
};

export type ImportJob = {
  id?: string;
  import_progress_url?: string;
  [k: string]: unknown;
};

// Synchronous single-subscriber upsert + group assignment. Much faster than
// the import-subscribers async pipeline (hundreds of ms vs seconds), so this
// is preferred when assigning ONE subscriber. Falls back to import if a
// caller has many subscribers to add.
export type SubscriberUpsert = {
  id: string;
  email: string;
  status?: string;
};
export async function upsertSubscriberToGroup(
  email: string,
  groupId: string,
): Promise<SubscriberUpsert> {
  const r = await call<{ data: SubscriberUpsert }>("POST", "/subscribers", {
    email,
    groups: [groupId],
    status: "active",
  });
  return r.data;
}

export async function importSubscribers(
  groupId: string,
  subscribers: ImportSubscriber[],
): Promise<ImportJob> {
  const r = await call<Record<string, unknown>>(
    "POST",
    `/groups/${groupId}/import-subscribers`,
    { subscribers },
  );
  const inner = r.data as ImportJob | undefined;
  return inner ?? (r as ImportJob);
}

export type ImportProgress = {
  processed?: number;
  imported?: number;
  percent?: number;
  done?: boolean;
  [k: string]: unknown;
};

export async function getImportProgress(url: string): Promise<ImportProgress> {
  const r = await getUrl<{ data?: ImportProgress } & ImportProgress>(url);
  return (r.data ?? r) as ImportProgress;
}

export async function getGroup(id: string): Promise<Group> {
  const r = await call<{ data: Group }>("GET", `/groups/${id}`);
  return r.data;
}

export async function listGroupSubscribers(
  groupId: string,
  opts: {
    status?: "active" | "unsubscribed" | "unconfirmed" | "bounced" | "junk";
    limit?: number;
    cursor?: string;
  } = {},
): Promise<{ subscribers: GroupSubscriber[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  params.set("limit", String(Math.min(opts.limit ?? 50, 1000)));
  if (opts.status) params.set("filter[status]", opts.status);
  if (opts.cursor) params.set("cursor", opts.cursor);
  const r = await call<{
    data: GroupSubscriber[];
    meta?: { next_cursor?: string | null };
  }>("GET", `/groups/${groupId}/subscribers?${params.toString()}`);
  return {
    subscribers: r.data ?? [],
    nextCursor: r.meta?.next_cursor ?? null,
  };
}

export async function listCampaigns(
  opts: {
    status?: "sent" | "draft" | "ready";
    type?: "regular" | "ab" | "resend" | "rss";
    limit?: number;
    page?: number;
  } = {},
): Promise<{ campaigns: Campaign[]; total: number | null }> {
  const params = new URLSearchParams();
  params.set("limit", String(opts.limit ?? 25));
  if (opts.page) params.set("page", String(opts.page));
  if (opts.status) params.set("filter[status]", opts.status);
  if (opts.type) params.set("filter[type]", opts.type);
  const r = await call<{
    data: Campaign[];
    meta?: { total?: number };
  }>("GET", `/campaigns?${params.toString()}`);
  return { campaigns: r.data ?? [], total: r.meta?.total ?? null };
}

export async function listSegments(): Promise<Segment[]> {
  const out: Segment[] = [];
  let page = 1;
  while (true) {
    const r = await call<{
      data: Segment[];
      meta?: { last_page?: number; current_page?: number };
    }>("GET", `/segments?limit=250&page=${page}`);
    out.push(...(r.data ?? []));
    const last = r.meta?.last_page ?? page;
    if (page >= last || (r.data ?? []).length === 0) break;
    page++;
  }
  return out;
}

export async function getSegment(id: string): Promise<Segment> {
  const all = await listSegments();
  const match = all.find((s) => s.id === id);
  if (!match) {
    throw new MailerLiteError(`segment ${id} not found`, 404, "");
  }
  return match;
}

export async function listSegmentSubscribers(
  segmentId: string,
  opts: {
    limit?: number;
    cursor?: string;
  } = {},
): Promise<{ subscribers: GroupSubscriber[]; nextCursor: string | null }> {
  // Note: MailerLite's /segments/{id}/subscribers endpoint ignores filter[status]
  // in practice despite what the docs claim — it always returns the segment's
  // own membership regardless. Status filtering lives on groups only.
  const params = new URLSearchParams();
  params.set("limit", String(Math.min(opts.limit ?? 50, 1000)));
  if (opts.cursor) params.set("cursor", opts.cursor);
  const r = await call<{
    data: GroupSubscriber[];
    meta?: { next_cursor?: string | null };
  }>(
    "GET",
    `/segments/${segmentId}/subscribers?${params.toString()}`,
  );
  return {
    subscribers: r.data ?? [],
    nextCursor: r.meta?.next_cursor ?? null,
  };
}

export async function getCampaign(id: string): Promise<Campaign> {
  const r = await call<{ data: Campaign }>("GET", `/campaigns/${id}`);
  return r.data;
}

export type CreateCampaignPayload = {
  name: string;
  type?: "regular" | "ab" | "resend" | "multivariate";
  language_id?: number;
  emails: Array<{
    subject: string;
    from_name: string;
    from: string;
    reply_to?: string;
    content?: string;
  }>;
  groups?: string[];
  segments?: string[];
  settings?: Record<string, unknown>;
};

export async function createCampaign(
  payload: CreateCampaignPayload,
): Promise<Campaign> {
  const body = { type: "regular", ...payload } as CreateCampaignPayload;
  const r = await call<{ data: Campaign }>("POST", "/campaigns", body);
  return r.data;
}

export type ScheduleCampaignPayload =
  | { delivery: "instant" }
  | {
      delivery: "scheduled";
      schedule: {
        date: string;
        hours: string;
        minutes: string;
        timezone_id?: number;
      };
    }
  | {
      delivery: "timezone_based";
      schedule: { date: string; hours: string; minutes: string };
    };

export async function scheduleCampaign(
  id: string,
  payload: ScheduleCampaignPayload,
): Promise<Campaign> {
  const r = await call<{ data: Campaign }>(
    "POST",
    `/campaigns/${id}/schedule`,
    payload,
  );
  return r.data;
}

export async function deleteCampaign(id: string): Promise<void> {
  await call<unknown>("DELETE", `/campaigns/${id}`);
}

export async function removeSubscriberFromGroup(
  subscriberId: string,
  groupId: string,
): Promise<void> {
  await call<unknown>(
    "DELETE",
    `/subscribers/${subscriberId}/groups/${groupId}`,
  );
}

export async function waitForImport(
  progressUrl: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<ImportProgress> {
  const intervalMs = opts.intervalMs ?? 3000;
  const timeoutMs = opts.timeoutMs ?? 240000;
  const start = Date.now();
  while (true) {
    const p = await getImportProgress(progressUrl);
    if (p.done) return p;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`import did not finish within ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
