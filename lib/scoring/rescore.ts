// Shared worker for bulk rescoring. Called by both the manual
// /api/sync/rescore endpoint and the nightly /api/cron/rescore endpoint so
// the logic stays in one place.

import type { createAdminClient } from "@/lib/supabase/admin";
import { applyScore } from "./apply";

type Db = ReturnType<typeof createAdminClient>;

export type RescoreOptions = {
  limit?: number | null;
  batchSize?: number;
  reason?: string;
  now?: Date;
};

export type RescoreSummary = {
  total_users: number;
  processed: number;
  changed: number;
  skipped: number;
  failure_count: number;
  failures: Array<{ user_id: string; error: string }>;
};

export async function rescoreAllUsers(
  db: Db,
  options: RescoreOptions = {},
): Promise<RescoreSummary> {
  const { limit = null, batchSize = 10, reason = "rescore.bulk", now = new Date() } = options;

  // Order by (created_at, id) so ties are broken deterministically — the
  // initial Whop backfill gives many users identical created_at timestamps.
  // Paginate via .range() because supabase-js applies a 1000-row default cap
  // that silently truncates larger result sets.
  const pageSize = 1000;
  const userIds: string[] = [];
  let offset = 0;
  while (true) {
    let query = db
      .from("users")
      .select("id")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (limit) {
      const remaining = limit - userIds.length;
      if (remaining <= 0) break;
      if (remaining < pageSize) {
        query = db
          .from("users")
          .select("id")
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + remaining - 1);
      }
    }
    const { data, error } = await query;
    if (error) throw new Error(`users list failed: ${error.message}`);
    const batch = (data ?? []).map((u) => u.id as string);
    userIds.push(...batch);
    if (batch.length < pageSize) break;
    if (limit && userIds.length >= limit) break;
    offset += pageSize;
  }

  let processed = 0;
  let changed = 0;
  let skipped = 0;
  const failures: Array<{ user_id: string; error: string }> = [];

  for (let i = 0; i < userIds.length; i += batchSize) {
    const chunk = userIds.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      chunk.map((id) => applyScore(db, id, { now, reason })),
    );
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === "fulfilled") {
        processed++;
        if (r.value.skipped) skipped++;
        else if (r.value.changed) changed++;
      } else {
        failures.push({
          user_id: chunk[j],
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    }
  }

  return {
    total_users: userIds.length,
    processed,
    changed,
    skipped,
    failure_count: failures.length,
    failures: failures.slice(0, 20),
  };
}
