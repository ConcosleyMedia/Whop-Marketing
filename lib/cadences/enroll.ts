// Enroll a user into a cadence. Idempotent on (cadence_id, user_id) — the
// unique constraint from migration 0004 makes a re-enrollment a no-op (the
// existing enrollment row stands).
//
// Called from:
//   * Whop webhook handler when membership.activated matches a cadence's
//     trigger_config.plan_ids
//   * Future segment-enrollment cron when a user joins a triggered segment
//   * Manual enrollment UI / API for testing

import type { createAdminClient } from "@/lib/supabase/admin";
import { CadenceSequence } from "./types";
import { writeActivity } from "@/lib/whop/upsert";

type Db = ReturnType<typeof createAdminClient>;

export type EnrollResult =
  | { ok: true; enrollment_id: string; created: boolean }
  | { ok: false; error: string };

export async function enrollUserInCadence(
  db: Db,
  cadenceId: string,
  userId: string,
  options: { reason?: string; now?: Date } = {},
): Promise<EnrollResult> {
  const now = options.now ?? new Date();

  // Confirm cadence exists and is active.
  const { data: cadence, error: cErr } = await db
    .from("cadences")
    .select("id, name, status, sequence_json")
    .eq("id", cadenceId)
    .maybeSingle();
  if (cErr) return { ok: false, error: `Cadence read failed: ${cErr.message}` };
  if (!cadence) return { ok: false, error: "Cadence not found" };
  if (cadence.status !== "active") {
    return { ok: false, error: `Cadence is ${cadence.status} (not active)` };
  }

  // Validate the sequence so we fail fast on a malformed cadence.
  const parsed = CadenceSequence.safeParse(cadence.sequence_json);
  if (!parsed.success) {
    return {
      ok: false,
      error: `Cadence sequence is invalid: ${parsed.error.issues[0]?.message}`,
    };
  }
  if (parsed.data.steps.length === 0) {
    return { ok: false, error: "Cadence has no steps" };
  }
  const firstDelayMs = parsed.data.steps[0].delay_hours * 3600_000;

  // Insert enrollment. ON CONFLICT (cadence_id, user_id) makes this idempotent.
  const { data: existing } = await db
    .from("cadence_enrollments")
    .select("id, status")
    .eq("cadence_id", cadenceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    return { ok: true, enrollment_id: existing.id as string, created: false };
  }

  const { data: row, error: insErr } = await db
    .from("cadence_enrollments")
    .insert({
      cadence_id: cadenceId,
      user_id: userId,
      current_step: 0,
      status: "active",
      enrolled_at: now.toISOString(),
      next_action_at: new Date(now.getTime() + firstDelayMs).toISOString(),
    })
    .select("id")
    .single();
  if (insErr) {
    // Race against another concurrent webhook? Re-fetch and treat as success.
    if (insErr.code === "23505") {
      const { data: again } = await db
        .from("cadence_enrollments")
        .select("id")
        .eq("cadence_id", cadenceId)
        .eq("user_id", userId)
        .single();
      if (again) {
        return { ok: true, enrollment_id: again.id as string, created: false };
      }
    }
    return { ok: false, error: insErr.message };
  }

  // Note: cadences.total_enrolled is denormalized — recomputed lazily in
  // the cadences UI via SELECT COUNT(*). Skipping the live increment keeps
  // this function single-write.

  await writeActivity(db, {
    user_id: userId,
    activity_type: "cadence.enrolled",
    title: `Enrolled in cadence: ${cadence.name}`,
    description: options.reason ?? null,
    related_entity_type: "cadence",
    related_entity_id: cadenceId,
    metadata: { reason: options.reason ?? null },
    occurred_at: now.toISOString(),
  });

  return { ok: true, enrollment_id: row.id as string, created: true };
}

// Find all active cadences whose Whop trigger matches the given plan_id.
// Returns cadence ids the caller can enroll the user into.
export async function findCadencesForWhopMembership(
  db: Db,
  planWhopId: string | null,
): Promise<string[]> {
  const { data, error } = await db
    .from("cadences")
    .select("id, trigger_type, trigger_config")
    .eq("status", "active")
    .eq("trigger_type", "whop_membership");
  if (error) return [];
  const matches: string[] = [];
  for (const row of (data ?? []) as Array<{
    id: string;
    trigger_config: { plan_ids?: string[] } | null;
  }>) {
    const cfg = row.trigger_config ?? {};
    const planIds = Array.isArray(cfg.plan_ids) ? cfg.plan_ids : [];
    // Empty list = match any plan. Otherwise must match.
    if (planIds.length === 0 || (planWhopId && planIds.includes(planWhopId))) {
      matches.push(row.id);
    }
  }
  return matches;
}

// Get a value at a dot-path inside an arbitrary JSON object. Used for the
// optional payload_path predicate on whop_event triggers.
function getAtPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

// Find cadences with trigger_type='whop_event' that match a given event.
// Caller passes the raw event.type (e.g. "membership.cancel_at_period_end_changed"),
// the affected plan id (null if not in payload), and the payload object so
// we can evaluate optional payload predicates.
export async function findCadencesForWhopEvent(
  db: Db,
  eventType: string,
  planWhopId: string | null,
  payload: unknown,
): Promise<string[]> {
  const { data, error } = await db
    .from("cadences")
    .select("id, trigger_type, trigger_config")
    .eq("status", "active")
    .eq("trigger_type", "whop_event");
  if (error) return [];

  const matches: string[] = [];
  for (const row of (data ?? []) as Array<{
    id: string;
    trigger_config: {
      event_types?: string[];
      plan_ids?: string[];
      payload_path?: string;
      payload_value?: string | number | boolean;
    } | null;
  }>) {
    const cfg = row.trigger_config ?? {};
    const eventTypes = Array.isArray(cfg.event_types) ? cfg.event_types : [];
    if (!eventTypes.includes(eventType)) continue;

    const planIds = Array.isArray(cfg.plan_ids) ? cfg.plan_ids : [];
    if (planIds.length > 0 && (!planWhopId || !planIds.includes(planWhopId))) {
      continue;
    }

    if (cfg.payload_path !== undefined) {
      const actual = getAtPath(payload, cfg.payload_path);
      if (actual !== cfg.payload_value) continue;
    }

    matches.push(row.id);
  }
  return matches;
}
