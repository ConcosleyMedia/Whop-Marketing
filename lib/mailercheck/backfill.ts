import { createAdminClient } from "@/lib/supabase/admin";
import {
  createList,
  getListResults,
  startListVerification,
  waitForListComplete,
} from "./client";

export type BackfillResult = {
  chunk_submitted: number;
  verified: number;
  remaining: number;
  list_id?: number;
  started_at: string;
  finished_at: string;
};

export type DryRunResult = {
  dry_run: true;
  unverified_users: number;
};

async function countUnverified(db: ReturnType<typeof createAdminClient>): Promise<number> {
  const { count, error } = await db
    .from("users")
    .select("id", { count: "exact", head: true })
    .is("verification_status", null);
  if (error) throw new Error(`count unverified failed: ${error.message}`);
  return count ?? 0;
}

export async function backfillVerification(options: {
  chunkSize?: number;
  dryRun?: boolean;
}): Promise<BackfillResult | DryRunResult> {
  const started_at = new Date().toISOString();
  const db = createAdminClient();
  const chunkSize = Math.min(Math.max(options.chunkSize ?? 1000, 1), 5000);

  if (options.dryRun) {
    const unverified_users = await countUnverified(db);
    return { dry_run: true, unverified_users };
  }

  const { data: users, error } = await db
    .from("users")
    .select("id, email, whop_user_id")
    .is("verification_status", null)
    .order("id", { ascending: true })
    .limit(chunkSize);
  if (error) throw new Error(`fetch users failed: ${error.message}`);
  if (!users || users.length === 0) {
    return {
      chunk_submitted: 0,
      verified: 0,
      remaining: 0,
      started_at,
      finished_at: new Date().toISOString(),
    };
  }

  const rows = users as unknown as Array<{ id: string; email: string; whop_user_id: string }>;
  const emails = Array.from(new Set(rows.map((u) => u.email).filter(Boolean)));

  const listName = `whop-backfill-${started_at.replace(/[:.]/g, "-")}`;
  const list = await createList(listName, emails);
  await startListVerification(list.id);
  await waitForListComplete(list.id, { intervalMs: 5000, timeoutMs: 240000 });

  const emailToUsers = new Map<string, Array<{ id: string }>>();
  for (const u of rows) {
    const arr = emailToUsers.get(u.email) ?? [];
    arr.push({ id: u.id });
    emailToUsers.set(u.email, arr);
  }

  let verified = 0;
  const checkedAt = new Date().toISOString();
  let page = 1;
  while (true) {
    const resp = await getListResults(list.id, page, 500);
    const items = resp.data ?? [];
    if (items.length === 0) break;

    for (const item of items) {
      const targets = emailToUsers.get(item.email);
      if (!targets) continue;
      const status = item.result ?? item.status;
      const { error: updateErr } = await db
        .from("users")
        .update({
          verification_status: status,
          verification_raw: JSON.stringify(item),
          verification_checked_at: checkedAt,
          verification_suggestion: (item.suggestion as string | undefined) ?? null,
          updated_at: new Date().toISOString(),
        })
        .in(
          "id",
          targets.map((t) => t.id),
        );
      if (updateErr) throw new Error(`user update failed: ${updateErr.message}`);
      verified += targets.length;
    }

    const lastPage = resp.meta?.last_page ?? page;
    if (page >= lastPage) break;
    page++;
  }

  const remaining = await countUnverified(db);

  return {
    chunk_submitted: rows.length,
    verified,
    remaining,
    list_id: list.id,
    started_at,
    finished_at: new Date().toISOString(),
  };
}
