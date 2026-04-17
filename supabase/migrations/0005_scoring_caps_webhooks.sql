-- Migration 5 — Scoring config, frequency caps, webhook log

CREATE TABLE scoring_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name TEXT UNIQUE NOT NULL,
  rule_description TEXT,
  points INT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO scoring_config (rule_name, rule_description, points) VALUES
  ('has_active_paid_membership', 'User has any active paid membership', 20),
  ('purchased_last_30_days', 'User made a purchase in last 30 days', 15),
  ('opened_email_last_7_days', 'User opened an email in last 7 days', 10),
  ('clicked_email_last_14_days', 'User clicked an email in last 14 days', 10),
  ('on_multiple_products', 'User is active on 2+ products simultaneously', 5),
  ('ltv_over_500', 'User total LTV exceeds $500', 15),
  ('positive_engagement_trend', 'More opens this month than last', 10),
  ('cancel_at_period_end', 'Membership is scheduled to cancel', -20),
  ('no_engagement_30_days', 'No opens or clicks in 30 days', -15),
  ('bounced_or_complained', 'User has bounced or complained', -10),
  ('failed_payment_90_days', 'Failed payment in last 90 days (per failure)', -5);

CREATE TABLE frequency_caps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  window_days INT NOT NULL,
  max_emails INT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO frequency_caps (window_days, max_emails) VALUES (7, 2);

CREATE TABLE webhook_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ,
  error TEXT,
  received_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (source, event_id)
);
CREATE INDEX idx_webhook_log_received ON webhook_log(received_at DESC);
