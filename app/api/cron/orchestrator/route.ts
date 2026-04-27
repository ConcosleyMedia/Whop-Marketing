// Hourly orchestrator. Re-evaluates segments + enrolls segment-triggered
// cadence members. The set-and-forget heart of the system.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runJob } from "@/lib/orchestrator/run-once";
import { runHourlyOrchestrator } from "@/lib/orchestrator/hourly";

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
  const result = await runJob(db, "orchestrator", async () => {
    const r = await runHourlyOrchestrator(db);
    return r;
  });
  return NextResponse.json({ ok: result.status !== "failed", ...result });
}
