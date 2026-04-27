// POST /api/sync/rescore
//
// Recompute lead score + temperature + lifecycle for every user. Meant for
// initial rollout (after backfilling sync data) and for nightly catch-up on
// time-decay signals (e.g. "no engagement in 30 days") that inline webhook
// scoring won't naturally re-trigger.
//
// Auth via x-sync-secret header. Returns a summary count — detailed changes
// land in the `activities` table as "score.changed" entries.
//
// Query params:
//   user_id=<uuid>         rescore a single user (useful for debugging)
//   limit=<n>              cap total users processed (default: all)
//   batch=<n>              concurrency (default: 10)

import { NextResponse } from "next/server";
import { checkSyncSecret } from "@/lib/sync-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyScore } from "@/lib/scoring/apply";
import { rescoreAllUsers } from "@/lib/scoring/rescore";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const authErr = checkSyncSecret(request);
  if (authErr) return authErr;

  const url = new URL(request.url);
  const singleUserId = url.searchParams.get("user_id");
  const limit = parseInt(url.searchParams.get("limit") ?? "0", 10) || null;
  const batchSize = Math.max(
    1,
    Math.min(50, parseInt(url.searchParams.get("batch") ?? "10", 10) || 10),
  );

  const db = createAdminClient();
  const now = new Date();

  if (singleUserId) {
    try {
      const outcome = await applyScore(db, singleUserId, {
        now,
        reason: "manual.rescore",
      });
      return NextResponse.json({ ok: true, outcome });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  try {
    const summary = await rescoreAllUsers(db, {
      limit,
      batchSize,
      reason: "manual.rescore",
      now,
    });
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
