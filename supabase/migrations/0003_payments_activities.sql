-- Migration 3 — Payments, email events, activities

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  whop_payment_id TEXT UNIQUE NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  membership_id UUID REFERENCES memberships(id),
  product_id UUID REFERENCES products(id),
  plan_id UUID REFERENCES plans(id),
  amount NUMERIC(10,2) NOT NULL,
  currency TEXT DEFAULT 'usd',
  status TEXT NOT NULL,
  substatus TEXT,
  paid_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  dispute_alerted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_payments_user ON payments(user_id);
CREATE INDEX idx_payments_product ON payments(product_id);
CREATE INDEX idx_payments_paid_at ON payments(paid_at DESC);

CREATE TABLE email_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  mailerlite_campaign_id TEXT,
  mailerlite_automation_id TEXT,
  app_campaign_id UUID,
  app_cadence_id UUID,
  email_subject TEXT,
  clicked_url TEXT,
  bounce_reason TEXT,
  metadata JSONB DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_email_events_user ON email_events(user_id);
CREATE INDEX idx_email_events_type ON email_events(event_type);
CREATE INDEX idx_email_events_occurred ON email_events(occurred_at DESC);
CREATE INDEX idx_email_events_user_type ON email_events(user_id, event_type);

CREATE TABLE activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,
  related_entity_type TEXT,
  related_entity_id UUID,
  title TEXT NOT NULL,
  description TEXT,
  metadata JSONB DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_activities_user_occurred ON activities(user_id, occurred_at DESC);
CREATE INDEX idx_activities_type ON activities(activity_type);
