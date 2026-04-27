// Cadence runner — Vercel Cron triggers this every 15 min.
// Sends due steps for active enrollments, advances state, completes finished
// enrollments. Works on a budget of `limit` rows per invocation; if more are
// due than the budget, the next run picks them up.
//
// Auth: Vercel sets Authorization: Bearer ${CRON_SECRET} on cron invocations.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runDueCadenceSteps } from "@/lib/cadences/run";
import { runJob } from "@/lib/orchestrator/run-once";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isCronAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return request.headers.get("authorization") === `Bearer ${expected}`;
}

function isManualAuthorized(request: Request): boolean {
  const expected = process.env.SYNC_SECRET;
  if (!expected) return false;
  return request.headers.get("x-sync-secret") === expected;
}

async function runOnce(limit: number) {
  const db = createAdminClient();
  const result = await runJob(db, "cadences", async () => {
    const summary = await runDueCadenceSteps(db, { limit });
    const status =
      summary.failed === 0
        ? "ok"
        : summary.sent + summary.completed > 0
          ? "partial"
          : "failed";
    if (status === "failed") {
      return {
        status,
        summary: summary as unknown as Record<string, unknown>,
        error: `All ${summary.failed} send attempts failed.`,
      };
    }
    return { status, summary: summary as unknown as Record<string, unknown> };
  });
  return NextResponse.json({ ok: result.status !== "failed", ...result });
}

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const limit = Math.max(
    1,
    Math.min(500, parseInt(url.searchParams.get("limit") ?? "200", 10) || 200),
  );
  return runOnce(limit);
}

export async function POST(request: Request) {
  if (!isManualAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const limit = Math.max(
    1,
    Math.min(500, parseInt(url.searchParams.get("limit") ?? "200", 10) || 200),
  );
  return runOnce(limit);
}
