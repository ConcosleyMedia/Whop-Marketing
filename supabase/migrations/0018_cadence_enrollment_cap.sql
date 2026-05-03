-- Migration 18 — Per-cadence enrollment cap.
--
-- Adds `max_new_enrollments_per_run` to cadences so the hourly orchestrator
-- can stage large reactivation pushes over many runs (e.g. 178/hour for the
-- 14k Free silent expansion in #7). NULL preserves the existing "enroll all
-- matching segment members in one pass" behavior — no change for in-flight
-- cadences.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE cadences
  ADD COLUMN IF NOT EXISTS max_new_enrollments_per_run INT;

COMMENT ON COLUMN cadences.max_new_enrollments_per_run IS
  'Hourly orchestrator caps new enrollments at this value per run. NULL = unlimited (current behavior). Used to stage large reactivation pushes.';
