-- Migration 12 — Template variables.
--
-- A key/value map of tokens that email templates can reference via
-- {{KEY_NAME}} syntax. Substitution happens:
--   1. Live in the editor preview (client-side)
--   2. Server-side at campaign send time, before the HTML is pushed to MailerLite
--
-- Keys are uppercase + underscore by convention (enforced by a CHECK) to keep
-- them distinct from MailerLite merge fields and old [bracketed] placeholders.
--
-- Seeded with the operator's Whop URLs so the 10 Build Room templates can be
-- migrated from [join-link] → {{WHOP_BUILDROOM_URL}} via Find/Replace.

CREATE TABLE template_variables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL CHECK (key ~ '^[A-Z][A-Z0-9_]*$' AND length(key) <= 64),
  value TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_template_variables_key ON template_variables(key);

ALTER TABLE template_variables ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_all_access ON template_variables FOR ALL USING (
  auth.jwt() ->> 'email' = current_setting('app.admin_email', true)
);

INSERT INTO template_variables (key, value, description) VALUES
  ('WHOP_FREE_URL',            'https://whop.com/checkout/plan_yRLG1PNR7m8Yh', 'Free tier checkout link'),
  ('WHOP_TRIAL_URL',           'https://whop.com/checkout/plan_CbVyv3zqRXaFH', 'Trial checkout link'),
  ('WHOP_BUILDROOM_URL',       'https://whop.com/automateit/build-room/',       '$9/mo Build Room community'),
  ('WHOP_COHORT_URL',          'https://whop.com/automateit/cohort-8e/',        '$297/mo group cohort'),
  ('WHOP_1TO1_WAITLIST_URL',   'https://whop.com/automateit/1-on-1-0a/',        '1-on-1 coaching waitlist');
