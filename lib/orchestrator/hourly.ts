// Hourly orchestrator. Two responsibilities:
//
//   1. Re-evaluate every dynamic segment so its members table reflects today's
//      data. Without this, a user who turned "active" 30 minutes ago still
//      doesn't appear in the "Active high-LTV" segment until the operator
//      manually re-evaluates.
//
//   2. For every cadence with trigger_type='segment_added', enroll all current
//      segment members who aren't already enrolled. Combined with (1) this
//      means a user becoming eligible for a segment automatically enters the
//      cadence within an hour, no operator action needed.
//
// Idempotent and self-healing — if a previous run failed mid-loop, the next
// run picks up from the same state. Cadence enrollment unique-constraint
// blocks dupes.

import type { createAdminClient } from "@/lib/supabase/admin";
import { evaluateSegment } from "@/lib/segments/evaluate";
import { FilterJsonSchema } from "@/lib/segments/schema";
import { enrollUserInCadence } from "@/lib/cadences/enroll";

type Db = ReturnType<typeof createAdminClient>;

export type HourlySummary = {
  segments_evaluated: number;
  segments_failed: number;
  segment_failures: Array<{ segment_id: string; error: string }>;
  cadences_processed: number;
  enrollments_created: number;
  enrollments_failed: number;
  cadence_failures: Array<{ cadence_id: string; user_id?: string; error: string }>;
};

export async function runHourlyOrchestrator(db: Db): Promise<{
  status: "ok" | "partial";
  summary: HourlySummary;
}> {
  const summary: HourlySummary = {
    segments_evaluated: 0,
    segments_failed: 0,
    segment_failures: [],
    cadences_processed: 0,
    enrollments_created: 0,
    enrollments_failed: 0,
    cadence_failures: [],
  };

  // --- 1. Re-evaluate all dynamic segments ---
  const { data: segments, error: segErr } = await db
    .from("segments")
    .select("id, name, filter_json, is_dynamic, is_starter_template")
    .or("is_starter_template.is.null,is_starter_template.eq.false")
    .or("is_dynamic.is.null,is_dynamic.eq.true");

  if (segErr) {
    return {
      status: "partial",
      summary: {
        ...summary,
        segment_failures: [{ segment_id: "(query)", error: segErr.message }],
      },
    };
  }

  for (const s of (segments ?? []) as Array<{
    id: string;
    name: string;
    filter_json: unknown;
  }>) {
    const parsed = FilterJsonSchema.safeParse(s.filter_json);
    if (!parsed.success) {
      summary.segments_failed++;
      summary.segment_failures.push({
        segment_id: s.id,
        error: `Invalid filter: ${parsed.error.issues[0]?.message ?? "unknown"}`,
      });
      continue;
    }
    try {
      await evaluateSegment(s.id, parsed.data);
      summary.segments_evaluated++;
    } catch (err) {
      summary.segments_failed++;
      summary.segment_failures.push({
        segment_id: s.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // --- 2. Enroll segment-triggered cadences ---
  const { data: cadences } = await db
    .from("cadences")
    .select("id, name, trigger_config")
    .eq("status", "active")
    .eq("trigger_type", "segment_added");

  for (const c of (cadences ?? []) as Array<{
    id: string;
    name: string;
    trigger_config: { segment_id?: string } | null;
  }>) {
    summary.cadences_processed++;
    const segmentId = c.trigger_config?.segment_id;
    if (!segmentId) {
      summary.cadence_failures.push({
        cadence_id: c.id,
        error: "trigger_config.segment_id missing",
      });
      continue;
    }

    // Find segment members not yet enrolled in this cadence.
    // Single SQL via RPC would be best; supabase-js doesn't support NOT IN
    // ergonomically against another query, so do two reads + a JS diff.
    const [{ data: members }, { data: existing }] = await Promise.all([
      db
        .from("segment_members")
        .select("user_id")
        .eq("segment_id", segmentId),
      db
        .from("cadence_enrollments")
        .select("user_id")
        .eq("cadence_id", c.id),
    ]);

    const enrolledSet = new Set(
      ((existing ?? []) as Array<{ user_id: string }>).map((r) => r.user_id),
    );
    const toEnroll = ((members ?? []) as Array<{ user_id: string }>)
      .map((r) => r.user_id)
      .filter((uid) => !enrolledSet.has(uid));

    for (const userId of toEnroll) {
      try {
        const r = await enrollUserInCadence(db, c.id, userId, {
          reason: `orchestrator.segment_added(${segmentId})`,
        });
        if (r.ok && r.created) summary.enrollments_created++;
      } catch (err) {
        summary.enrollments_failed++;
        summary.cadence_failures.push({
          cadence_id: c.id,
          user_id: userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const status =
    summary.segments_failed === 0 && summary.enrollments_failed === 0
      ? "ok"
      : "partial";
  return { status, summary };
}
