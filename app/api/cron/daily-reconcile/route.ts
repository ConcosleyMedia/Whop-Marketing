// Daily reconcile cron — drift correction.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runJob } from "@/lib/orchestrator/run-once";
import { runDailyReconcile } from "@/lib/orchestrator/daily";

export const dynamic = "force-dynamic";
// 25k memberships + 9k payments takes ~5 min via the iterating Whop API.
// Vercel Pro's max is 900s; Hobby is 300s. Set near Pro's max — if Vercel
// kills it on Hobby, split into two cron routes.
export const maxDuration = 800;

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

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return runOnce();
}

export async function POST(request: Request) {
  if (!isManualAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return runOnce();
}

async function runOnce() {
  const db = createAdminClient();
  const result = await runJob(db, "daily-reconcile", async () => {
    return runDailyReconcile(db);
  });
  return NextResponse.json({ ok: result.status !== "failed", ...result });
}
