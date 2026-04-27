-- Migration 10 — Email templates library.
--
-- A reusable collection of HTML email templates with free-form labels for
-- organization. Referenced by campaigns via app_template_id (nullable —
-- campaigns can still accept ad-hoc HTML without a template).
--
-- Labels are stored as a TEXT[] so a template can carry multiple tags
-- (e.g. {"winback","trading","Q2-2026"}). A GIN index makes label filtering
-- fast for the list page.

CREATE TABLE email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  labels TEXT[] DEFAULT '{}',
  html TEXT NOT NULL,
  suggested_subject TEXT,
  preview_text TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_email_templates_labels ON email_templates USING GIN (labels);
CREATE INDEX idx_email_templates_updated ON email_templates(updated_at DESC);

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_all_access ON email_templates FOR ALL USING (
  auth.jwt() ->> 'email' = current_setting('app.admin_email', true)
);

ALTER TABLE campaigns ADD COLUMN app_template_id UUID REFERENCES email_templates(id) ON DELETE SET NULL;
CREATE INDEX idx_campaigns_template ON campaigns(app_template_id);
