-- Migration 13 — Cadence runtime (sequence schema + idempotency).
--
-- The 0004 migration created `cadences` and `cadence_enrollments` tables. This
-- migration adds the runtime fields the cron worker needs:
--   * cadences.last_step_index — implicit: derived from sequence_json length
--   * cadence_enrollments.last_sent_step — what step we already SENT (so we
--     don't resend on retries / overlapping cron runs)
--   * unique constraint already exists on (cadence_id, user_id) — keeps
--     enrollment idempotent on webhook retries
--
-- Sequence JSON shape (stored in cadences.sequence_json):
--   {
--     "version": 1,
--     "steps": [
--       { "type": "send_email", "template_id": "<uuid>", "delay_hours": 0 },
--       { "type": "send_email", "template_id": "<uuid>", "delay_hours": 24 },
--       ...
--     ]
--   }
--
-- Trigger config shape (cadences.trigger_config):
--   trigger_type='whop_membership' → { plan_ids: ["plan_xxx"] } (or empty = any)
--   trigger_type='segment_added'   → { segment_id: "<uuid>" }
--   trigger_type='manual'          → {}

ALTER TABLE cadence_enrollments
  ADD COLUMN IF NOT EXISTS last_sent_step INT,
  ADD COLUMN IF NOT EXISTS last_send_error TEXT,
  ADD COLUMN IF NOT EXISTS last_send_at TIMESTAMPTZ;

-- Cron runner needs to lock-and-claim due enrollments without two runs
-- double-sending the same step. We'll use SELECT ... FOR UPDATE SKIP LOCKED
-- in the worker query, but a partial index on the predicate keeps it cheap.
CREATE INDEX IF NOT EXISTS idx_cadence_enrollments_due
  ON cadence_enrollments (next_action_at)
  WHERE status = 'active' AND next_action_at IS NOT NULL;
