// Cadence runner — invoked by /api/cron/cadences every 15 minutes.
//
// Algorithm:
//   1. Find all enrollments where status='active' AND next_action_at <= NOW()
//   2. For each, load the cadence's sequence_json + the current step
//   3. Send the step via lib/cadences/send.ts
//   4. Bump current_step + last_sent_step
//   5. If there's a next step → set next_action_at = NOW() + delay_hours
//      Otherwise → mark status='completed', completed_at=NOW()
//
// Concurrency: we use SELECT ... FOR UPDATE SKIP LOCKED via RPC to avoid two
// runs double-sending. As a defensive guard, the worker also checks
// last_sent_step >= current_step before each send (which means another worker
// already advanced it).

import type { createAdminClient } from "@/lib/supabase/admin";
import { sendCadenceStep } from "./send";
import { CadenceSequence, type CadenceSequenceT } from "./types";
import { evaluateExitCondition } from "./exit-conditions";

type Db = ReturnType<typeof createAdminClient>;

export type RunnerSummary = {
  scanned: number;
  sent: number;
  completed: number;
  skipped: number;
  failed: number;
  failures: Array<{ enrollment_id: string; error: string }>;
};

export async function runDueCadenceSteps(
  db: Db,
  options: { limit?: number; now?: Date } = {},
): Promise<RunnerSummary> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 200;

  const { data: due, error } = await db
    .from("cadence_enrollments")
    .select("id, cadence_id, user_id, current_step, last_sent_step, status")
    .eq("status", "active")
    .lte("next_action_at", now.toISOString())
    .order("next_action_at", { ascending: true })
    .limit(limit);

  if (error) {
    return {
      scanned: 0,
      sent: 0,
      completed: 0,
      skipped: 0,
      failed: 1,
      failures: [{ enrollment_id: "(query)", error: error.message }],
    };
  }

  const summary: RunnerSummary = {
    scanned: due?.length ?? 0,
    sent: 0,
    completed: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  };

  // Cache cadence definitions across the batch — many enrollments share one.
  const cadenceCache = new Map<string, CadenceSequenceT | null>();
  async function getSequence(cadenceId: string): Promise<CadenceSequenceT | null> {
    if (cadenceCache.has(cadenceId)) return cadenceCache.get(cadenceId)!;
    const { data, error: cErr } = await db
      .from("cadences")
      .select("sequence_json, status")
      .eq("id", cadenceId)
      .single();
    if (cErr || !data || data.status !== "active") {
      cadenceCache.set(cadenceId, null);
      return null;
    }
    const parsed = CadenceSequence.safeParse(data.sequence_json);
    const seq = parsed.success ? parsed.data : null;
    cadenceCache.set(cadenceId, seq);
    return seq;
  }

  for (const e of (due ?? []) as Array<{
    id: string;
    cadence_id: string;
    user_id: string;
    current_step: number;
    last_sent_step: number | null;
  }>) {
    // Defensive: another worker may have already sent this step.
    if (e.last_sent_step !== null && e.last_sent_step >= e.current_step) {
      summary.skipped++;
      continue;
    }

    const seq = await getSequence(e.cadence_id);
    if (!seq) {
      // Cadence paused or invalid → exit the enrollment.
      await db
        .from("cadence_enrollments")
        .update({
          status: "exited",
          exit_reason: "cadence_unavailable",
          last_send_error: "cadence is paused, deleted, or has invalid sequence",
        })
        .eq("id", e.id);
      summary.skipped++;
      continue;
    }

    if (e.current_step >= seq.steps.length) {
      // Already past last step — clean up.
      await db
        .from("cadence_enrollments")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", e.id);
      summary.completed++;
      continue;
    }

    const step = seq.steps[e.current_step];

    // Per-step exit conditions: re-read user state and bail out if the
    // user no longer meets the criteria the cadence assumed. e.g., a
    // cancel-save cadence stops as soon as cancel_at_period_end goes
    // back to false.
    if (step.exit_if) {
      const exitReason = await evaluateExitCondition(
        db,
        e.user_id,
        step.exit_if,
      );
      if (exitReason) {
        await db
          .from("cadence_enrollments")
          .update({
            status: "exited",
            exit_reason: exitReason,
            completed_at: new Date().toISOString(),
            next_action_at: null,
            last_send_at: new Date().toISOString(),
          })
          .eq("id", e.id);
        summary.skipped++;
        continue;
      }
    }

    // Send the email.
    const result = await sendCadenceStep(db, {
      cadence_id: e.cadence_id,
      enrollment_id: e.id,
      user_id: e.user_id,
      step_index: e.current_step,
      template_id: step.template_id,
    });

    if (!result.ok) {
      summary.failed++;
      summary.failures.push({ enrollment_id: e.id, error: result.error ?? "unknown" });
      // Don't advance — leave next_action_at where it is so the next cron
      // run retries. Record the error.
      await db
        .from("cadence_enrollments")
        .update({
          last_send_error: result.error ?? "unknown",
          last_send_at: new Date().toISOString(),
        })
        .eq("id", e.id);
      continue;
    }

    summary.sent++;

    // Advance. Compute next state based on whether more steps remain.
    const nextIndex = e.current_step + 1;
    const isLast = nextIndex >= seq.steps.length;
    if (isLast) {
      await db
        .from("cadence_enrollments")
        .update({
          current_step: nextIndex,
          last_sent_step: e.current_step,
          status: "completed",
          completed_at: new Date().toISOString(),
          next_action_at: null,
          last_send_error: null,
          last_send_at: new Date().toISOString(),
        })
        .eq("id", e.id);
      summary.completed++;
    } else {
      const nextDelayMs = seq.steps[nextIndex].delay_hours * 3600_000;
      await db
        .from("cadence_enrollments")
        .update({
          current_step: nextIndex,
          last_sent_step: e.current_step,
          next_action_at: new Date(Date.now() + nextDelayMs).toISOString(),
          last_send_error: null,
          last_send_at: new Date().toISOString(),
        })
        .eq("id", e.id);
    }
  }

  return summary;
}
