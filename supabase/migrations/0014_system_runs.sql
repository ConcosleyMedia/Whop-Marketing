-- Migration 14 — System runs log.
--
-- Every cron job (rescore, cadences, orchestrator, daily-reconcile) writes one
-- row per invocation here. Powers the /admin/health dashboard so the operator
-- can verify the system is alive without poking individual screens.
--
-- Convention:
--   job        — short kebab-case identifier ('rescore', 'cadences-run',
--                'orchestrator', 'daily-reconcile')
--   started_at / finished_at — bounds; duration_ms = finished - started
--   status     — 'ok' | 'partial' | 'failed'
--   summary    — JSONB with the per-job result shape (counts, failures, etc.)
--   error      — populated only for status='failed'

CREATE TABLE IF NOT EXISTS system_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  duration_ms INT,
  status TEXT NOT NULL DEFAULT 'ok',
  summary JSONB DEFAULT '{}'::jsonb,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_runs_job_recent
  ON system_runs(job, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_runs_failed
  ON system_runs(started_at DESC) WHERE status = 'failed';

ALTER TABLE system_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_all_access ON system_runs FOR ALL USING (
  auth.jwt() ->> 'email' = current_setting('app.admin_email', true)
);
