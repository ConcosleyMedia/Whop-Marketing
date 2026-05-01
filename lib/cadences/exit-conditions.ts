// Evaluate per-step exit conditions against a user's CURRENT state.
//
// Called by the cadence runner before each step. If the condition matches,
// the runner short-circuits the enrollment (no more sends) with the given
// reason — useful for "stop the cancel-save cadence the moment they
// un-cancel" or "stop the past-due cadence as soon as their card works."

import type { createAdminClient } from "@/lib/supabase/admin";
import type {
  ExitConditionRuleT,
  ExitConditionT,
} from "./types";

type Db = ReturnType<typeof createAdminClient>;

type UserState = {
  lifecycle_stage: string | null;
  lead_temperature: string | null;
  total_ltv: number;
  any_active_membership: boolean;
  any_cancel_at_period_end: boolean;
  any_past_due_membership: boolean;
};

async function fetchUserState(db: Db, userId: string): Promise<UserState | null> {
  const [{ data: user }, { data: memberships }] = await Promise.all([
    db
      .from("users")
      .select("lifecycle_stage, lead_temperature, total_ltv")
      .eq("id", userId)
      .maybeSingle(),
    db
      .from("memberships")
      .select("status, cancel_at_period_end")
      .eq("user_id", userId),
  ]);
  if (!user) return null;

  const ms = (memberships ?? []) as Array<{
    status: string | null;
    cancel_at_period_end: boolean | null;
  }>;

  return {
    lifecycle_stage: user.lifecycle_stage ?? null,
    lead_temperature: user.lead_temperature ?? null,
    total_ltv: Number(user.total_ltv ?? 0),
    any_active_membership: ms.some((m) => m.status === "active"),
    any_cancel_at_period_end: ms.some((m) => m.cancel_at_period_end === true),
    any_past_due_membership: ms.some((m) => m.status === "past_due"),
  };
}

function ruleMatches(state: UserState, rule: ExitConditionRuleT): boolean {
  const actual = state[rule.field as keyof UserState];

  switch (rule.op) {
    case "is_true":
      return actual === true;
    case "is_false":
      return actual === false;
    case "eq":
      return actual === rule.value;
    case "neq":
      return actual !== rule.value;
    case "gt":
      return Number(actual ?? 0) > Number(rule.value ?? 0);
    case "gte":
      return Number(actual ?? 0) >= Number(rule.value ?? 0);
    case "lt":
      return Number(actual ?? 0) < Number(rule.value ?? 0);
    case "lte":
      return Number(actual ?? 0) <= Number(rule.value ?? 0);
    default:
      return false;
  }
}

// Returns null if the condition doesn't fire (proceed with the step), or
// the reason string if it does (exit the enrollment).
export async function evaluateExitCondition(
  db: Db,
  userId: string,
  cond: ExitConditionT,
): Promise<string | null> {
  const state = await fetchUserState(db, userId);
  if (!state) return null;

  const results = cond.rules.map((r) => ruleMatches(state, r));
  const fires =
    cond.match === "any" ? results.some(Boolean) : results.every(Boolean);

  return fires ? cond.reason : null;
}
