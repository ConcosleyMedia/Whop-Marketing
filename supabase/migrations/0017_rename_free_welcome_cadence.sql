-- Migration 17 — Rename the "Build Room · 10-day welcome" cadence.
--
-- The cadence with id 9bdb0f77-2871-4ad9-baab-c7ed695860b8 fires on
-- whop_membership for plan_yRLG1PNR7m8Yh, which is the FREE AutomationFlow
-- plan ($0/$0), not the paid Build Room plan as the original name implied.
-- The description was already accurate; only the name was misleading.
--
-- Idempotent: running twice produces the same result.

UPDATE cadences
SET name = 'Free signup · 10-day welcome'
WHERE id = '9bdb0f77-2871-4ad9-baab-c7ed695860b8';
