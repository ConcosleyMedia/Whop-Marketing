-- Migration 9 — Record how many users a campaign excluded due to frequency
-- capping at send time. Shown on the campaign detail page so the operator
-- can see at a glance how much of the intended audience was dropped.

ALTER TABLE campaigns
  ADD COLUMN cap_excluded_count INT DEFAULT 0;
