// Wraps any async cron-job body so its execution is timed and logged into
// `system_runs`. Use it once per cron route handler. The wrapper:
//   * Inserts a 'running' row before the job starts (so partial-run failures
//     are still visible in the health page)
//   * Captures the returned summary as JSONB
//   * Marks status='ok' / 'partial' / 'failed' based on outcome
//   * Always populates finished_at + duration_ms

import type { createAdminClient } from "@/lib/supabase/admin";

type Db = ReturnType<typeof createAdminClient>;

export type JobResult<T extends Record<string, unknown> = Record<string, unknown>> =
  | { status: "ok"; summary: T }
  | { status: "partial"; summary: T; error?: string }
  | { status: "failed"; summary?: T; error: string };

export async function runJob<T extends Record<string, unknown>>(
  db: Db,
  job: string,
  body: () => Promise<JobResult<T>>,
): Promise<JobResult<T> & { run_id: string; duration_ms: number }> {
  const startedAt = new Date();
  const { data: row, error: insErr } = await db
    .from("system_runs")
    .insert({
      job,
      started_at: startedAt.toISOString(),
      status: "ok", // optimistic; updated below
      summary: {},
    })
    .select("id")
    .single();
  if (insErr) {
    // We can't log the run, but the job should still execute.
    const fallback = await safelyRun(body);
    return {
      ...fallback,
      run_id: "(unlogged)",
      duration_ms: Date.now() - startedAt.getTime(),
    };
  }
  const runId = row.id as string;

  const result = await safelyRun(body);
  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();

  await db
    .from("system_runs")
    .update({
      finished_at: finishedAt.toISOString(),
      duration_ms: durationMs,
      status: result.status,
      summary: result.summary ?? {},
      error: "error" in result ? result.error : null,
    })
    .eq("id", runId);

  return { ...result, run_id: runId, duration_ms: durationMs };
}

async function safelyRun<T extends Record<string, unknown>>(
  body: () => Promise<JobResult<T>>,
): Promise<JobResult<T>> {
  try {
    return await body();
  } catch (err) {
    return {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
