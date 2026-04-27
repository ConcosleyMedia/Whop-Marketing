// Nightly rescore — invoked by Vercel Cron (see vercel.json).
//
// Vercel Cron sends GET with header: Authorization: Bearer ${CRON_SECRET}.
// This catches time-decay signals (e.g. "no engagement in 30 days") that
// wouldn't naturally re-fire via webhooks on dormant users.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rescoreAllUsers } from "@/lib/scoring/rescore";
import { runJob } from "@/lib/orchestrator/run-once";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = request.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = createAdminClient();
  const result = await runJob(db, "rescore", async () => {
    const summary = await rescoreAllUsers(db, {
      batchSize: 10,
      reason: "nightly.rescore",
    });
    const status =
      summary.failure_count === 0
        ? "ok"
        : summary.processed > 0
          ? "partial"
          : "failed";
    if (status === "failed") {
      return {
        status,
        summary: summary as unknown as Record<string, unknown>,
        error: `All ${summary.failure_count} attempts failed.`,
      };
    }
    return { status, summary: summary as unknown as Record<string, unknown> };
  });
  return NextResponse.json({ ok: result.status !== "failed", ...result });
}
