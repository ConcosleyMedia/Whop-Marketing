-- Migration 6 — Row-Level Security
-- Enable RLS on every table and restrict to the single admin email.
-- Set the admin email at Postgres startup:
--   ALTER DATABASE postgres SET app.admin_email = 'admin@example.com';
-- or set it per-session via SET app.admin_email.

DO $$
DECLARE
  tbl TEXT;
  tbls TEXT[] := ARRAY[
    'companies', 'products', 'plans', 'users', 'memberships', 'payments',
    'email_events', 'activities', 'segments', 'segment_members',
    'campaigns', 'cadences', 'cadence_enrollments', 'scoring_config',
    'frequency_caps', 'webhook_log'
  ];
BEGIN
  FOREACH tbl IN ARRAY tbls LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format(
      'CREATE POLICY admin_all_access ON %I FOR ALL USING ('
      || 'auth.jwt() ->> ''email'' = current_setting(''app.admin_email'', true)'
      || ')',
      tbl
    );
  END LOOP;
END $$;
