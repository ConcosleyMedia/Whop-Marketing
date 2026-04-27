// Cadence shape — stored in cadences.sequence_json. The runtime engine
// only knows about `send_email` for v1; future step types (wait_until,
// branch_if, exit_if) plug in here.

import { z } from "zod";

export const SendEmailStep = z.object({
  type: z.literal("send_email"),
  template_id: z.string().uuid(),
  delay_hours: z.number().int().min(0).max(24 * 365),
  // Optional override: send only if user is still in this segment at the
  // moment of send (skip step if not). Leave undefined for unconditional.
  require_segment_id: z.string().uuid().optional(),
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

export type TriggerType =
  | "whop_membership"
  | "segment_added"
  | "manual";

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  whop_membership: "New Whop membership",
  segment_added: "Added to segment",
  manual: "Manual / API",
};
