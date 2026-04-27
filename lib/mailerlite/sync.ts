import { createAdminClient } from "@/lib/supabase/admin";
import {
  ensureField,
  findOrCreateGroup,
  importSubscribers,
  listFields,
  waitForImport,
  type ImportSubscriber,
} from "./client";

export type MailerLiteSyncResult = {
  group_id: string;
  group_name: string;
  fields_ready: string[];
  chunks_submitted: number;
  subscribers_submitted: number;
  total_processed: number;
  total_imported: number;
  remaining: number;
  started_at: string;
  finished_at: string;
};

const GROUP_NAME = "whop-all";

const FIELD_DEFS: Array<{ name: string; type: "text" | "number" | "date" }> = [
  { name: "whop_user_id", type: "text" },
  { name: "lifecycle_stage", type: "text" },
  { name: "total_ltv", type: "number" },
  { name: "first_seen_at", type: "date" },
  { name: "last_purchased_at", type: "date" },
  { name: "active_products", type: "text" },
  { name: "ever_products", type: "text" },
];

type ViewRow = {
  id: string;
  whop_user_id: string;
  email: string;
  first_seen_at: string | null;
  lifecycle_stage: string;
  total_ltv: string | number;
  last_purchased_at: string | null;
  active_products: string;
  ever_products: string;
};

function toDateOnly(val: string | null): string | null {
  if (!val) return null;
  return val.slice(0, 10);
}

function toNumber(val: string | number): number {
  if (typeof val === "number") return val;
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : 0;
}

export async function syncSubscribersToMailerLite(options: {
  chunkSize?: number;
  maxChunks?: number;
  offset?: number;
}): Promise<MailerLiteSyncResult> {
  const started_at = new Date().toISOString();
  const db = createAdminClient();

  const chunkSize = Math.min(Math.max(options.chunkSize ?? 1000, 1), 5000);
  const maxChunks = options.maxChunks ?? 100;
  let offset = options.offset ?? 0;

  const existingFields = await listFields();
  for (const def of FIELD_DEFS) {
    await ensureField(existingFields, def.name, def.type);
  }
  const fields_ready = FIELD_DEFS.map((f) => f.name);

  const group = await findOrCreateGroup(GROUP_NAME);

  let chunks_submitted = 0;
  let subscribers_submitted = 0;
  let total_processed = 0;
  let total_imported = 0;

  while (chunks_submitted < maxChunks) {
    const { data, error } = await db
      .from("user_marketing_view")
      .select(
        "id, whop_user_id, email, first_seen_at, lifecycle_stage, total_ltv, last_purchased_at, active_products, ever_products",
      )
      .not("email", "is", null)
      .gt("total_ltv", 0)
      .order("id", { ascending: true })
      .range(offset, offset + chunkSize - 1);
    if (error) throw new Error(`user view fetch failed: ${error.message}`);
    const rows = (data ?? []) as unknown as ViewRow[];
    if (rows.length === 0) break;

    const subscribers: ImportSubscriber[] = rows.map((r) => ({
      email: r.email,
      fields: {
        whop_user_id: r.whop_user_id,
        lifecycle_stage: r.lifecycle_stage,
        total_ltv: toNumber(r.total_ltv),
        first_seen_at: toDateOnly(r.first_seen_at),
        last_purchased_at: toDateOnly(r.last_purchased_at),
        active_products: r.active_products,
        ever_products: r.ever_products,
      },
    }));

    const job = await importSubscribers(group.id, subscribers);
    subscribers_submitted += subscribers.length;
    chunks_submitted++;

    const progressUrl = job.import_progress_url;
    if (progressUrl) {
      const final = await waitForImport(progressUrl, { intervalMs: 3000, timeoutMs: 240000 });
      if (typeof final.processed === "number") total_processed += final.processed;
      if (typeof final.imported === "number") total_imported += final.imported;
    }

    offset += rows.length;
    if (rows.length < chunkSize) break;
  }

  const { count: remaining_count } = await db
    .from("user_marketing_view")
    .select("id", { count: "exact", head: true })
    .not("email", "is", null)
    .gt("total_ltv", 0);

  return {
    group_id: group.id,
    group_name: group.name,
    fields_ready,
    chunks_submitted,
    subscribers_submitted,
    total_processed,
    total_imported,
    remaining: Math.max(0, (remaining_count ?? 0) - offset),
    started_at,
    finished_at: new Date().toISOString(),
  };
}
