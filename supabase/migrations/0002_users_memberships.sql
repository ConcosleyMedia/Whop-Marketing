-- Migration 2 — Users and memberships

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  whop_user_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  username TEXT,
  first_seen_at TIMESTAMPTZ,
  -- verification
  verification_status TEXT,
  verification_raw TEXT,
  verification_checked_at TIMESTAMPTZ,
  verification_suggestion TEXT,
  -- mailerlite
  mailerlite_subscriber_id TEXT,
  mailerlite_groups TEXT[] DEFAULT '{}',
  -- derived
  lifecycle_stage TEXT,
  lead_score INT DEFAULT 0,
  lead_temperature TEXT,
  total_ltv NUMERIC(10,2) DEFAULT 0,
  last_engagement_at TIMESTAMPTZ,
  -- internal
  internal_notes TEXT,
  custom_tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_lifecycle ON users(lifecycle_stage);
CREATE INDEX idx_users_temperature ON users(lead_temperature);
CREATE INDEX idx_users_score ON users(lead_score DESC);

CREATE TABLE memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  whop_membership_id TEXT UNIQUE NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  plan_id UUID REFERENCES plans(id),
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  joined_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  renewal_period_start TIMESTAMPTZ,
  renewal_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  cancel_option TEXT,
  cancellation_reason TEXT,
  total_spent_on_membership NUMERIC(10,2) DEFAULT 0,
  promo_code_id TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_memberships_user ON memberships(user_id);
CREATE INDEX idx_memberships_product ON memberships(product_id);
CREATE INDEX idx_memberships_status ON memberships(status);
CREATE INDEX idx_memberships_user_product ON memberships(user_id, product_id);
CREATE INDEX idx_memberships_joined ON memberships(joined_at DESC);
