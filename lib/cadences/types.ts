// Cadence shape — stored in cadences.sequence_json. The runtime engine
// supports `send_email` for v1, with optional per-step `exit_if` that
// short-circuits the enrollment if the user state has changed.

import { z } from "zod";

// `exit_if` is an optional filter evaluated before each step. If it
// matches the user's CURRENT state (re-read at runtime, not at enrollment
// time), the enrollment is exited with the given reason and no further
// steps run. Use cases:
//   - "stop the cancel-save cadence if they un-cancelled"
//   - "stop the past-due cadence if their card got fixed"
//   - "stop the win-back cadence if they re-purchased"
//
// Field set is a small subset of segment_eligibility_view columns we know
// are cheap to query per-user. Op set is a subset of the segment ops.
export const ExitConditionRule = z.object({
  field: z.enum([
    "lifecycle_stage",
    "lead_temperature",
    "total_ltv",
    "any_active_membership",          // true if user has any status='active' membership
    "any_cancel_at_period_end",       // true if user has any membership with cancel_at_period_end=true
    "any_past_due_membership",        // true if user has any status='past_due' membership
  ]),
  op: z.enum(["eq", "neq", "gt", "lt", "gte", "lte", "is_true", "is_false"]),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

export const ExitCondition = z.object({
  match: z.enum(["all", "any"]).default("all"),
  rules: z.array(ExitConditionRule).min(1).max(10),
  reason: z.string().min(1).max(80),
});

export type ExitConditionT = z.infer<typeof ExitCondition>;
export type ExitConditionRuleT = z.infer<typeof ExitConditionRule>;

export const SendEmailStep = z.object({
  type: z.literal("send_email"),
  template_id: z.string().uuid(),
  delay_hours: z.number().int().min(0).max(24 * 365),
  // Skip step if user is no longer in this segment at send time.
  require_segment_id: z.string().uuid().optional(),
  // Exit the entire cadence if the rule matches at send time.
  exit_if: ExitCondition.optional(),
});

export const CadenceStep = SendEmailStep; // union grows here

export const CadenceSequence = z.object({
  version: z.literal(1),
  steps: z.array(CadenceStep).min(1).max(50),
});

export type CadenceSequenceT = z.infer<typeof CadenceSequence>;
export type CadenceStepT = z.infer<typeof CadenceStep>;

// Trigger config — what causes a user to enter the cadence.
export const TriggerConfigWhop = z.object({
  // Which Whop plans qualify. Empty array = any membership activation.
  plan_ids: z.array(z.string()).default([]),
});

export const TriggerConfigSegment = z.object({
  segment_id: z.string().uuid(),
});

// New: trigger on any specific Whop webhook event type. Unlocks save-flow
// (cancel_at_period_end_changed), past-due rescue (payment.failed), etc.
export const TriggerConfigWhopEvent = z.object({
  // List of event types that fire this cadence — e.g.
  //   ["membership.cancel_at_period_end_changed"]
  //   ["payment.failed"]
  // Matched against the webhook event.type field.
  event_types: z.array(z.string()).min(1),
  // Optional plan filter: only fire if the affected membership is on one
  // of these plan ids. Empty = any plan.
  plan_ids: z.array(z.string()).default([]),
  // Optional event-payload predicate. For cancel events, set
  // payload_path="cancel_at_period_end" and payload_value=true to fire
  // ONLY when the user just clicked cancel (not when they un-cancel).
  payload_path: z.string().optional(),
  payload_value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

export type TriggerType =
  | "whop_membership"
  | "whop_event"
  | "segment_added"
  | "manual";

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  whop_membership: "New Whop membership",
  whop_event: "Whop event (any type)",
  segment_added: "Added to segment",
  manual: "Manual / API",
};
