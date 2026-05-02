-- Migration 16 — Cleanup duplicate cancel-save cadence from migration 0015.
--
-- Migration 0015 seeded a `Cancel save · 3-touch save flow` cadence + 3
-- placeholder templates without checking the DB first. An existing cadence
-- `Build Room · Cancel-save` (id 97709cc8-…) was already active with
-- identical trigger config and real populated copy — making 0015's seed a
-- functional duplicate.
--
-- The existing cadence's `Build Room ·` name prefix was also misleading:
-- its trigger_config.plan_ids is [] so it actually fires on every cancel,
-- not just Build Room. Operator confirmed company-wide is the intent.
--
-- This migration:
--   1. Renames the existing cadence to drop the misleading prefix
--   2. Deletes the duplicate cadence row from 0015
--   3. Deletes the 3 redundant placeholder templates from 0015
--
-- Past-due rescue + win-back cadences/templates from 0015 are NOT touched —
-- those are genuinely new and not duplicates.

-- 1. Rename the existing active cadence to reflect its actual scope.
UPDATE cadences
SET name = 'Cancel-save · 3-touch',
    description = 'Fires on any membership cancel (cancel_at_period_end=true). Each step exits early if the user un-cancels before the send. Company-wide — not scoped to a specific plan.',
    updated_at = NOW()
WHERE id = '97709cc8-56a1-46a7-97e9-fb5798f3e3a0';

-- 2. Drop the duplicate cadence seeded by 0015.
DELETE FROM cadences
WHERE id = '22222222-2222-2222-2222-c00000000001';

-- 3. Drop the 3 redundant cancel-save placeholder templates from 0015.
DELETE FROM email_templates
WHERE id IN (
  '11111111-1111-1111-1111-c00000000001',
  '11111111-1111-1111-1111-c00000000002',
  '11111111-1111-1111-1111-c00000000003'
);
