-- Migration 1 — Core entities
-- companies, products, plans

CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  whop_company_id TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  whop_product_id TEXT UNIQUE NOT NULL,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  headline TEXT,
  description TEXT,
  visibility TEXT,
  business_type TEXT,
  industry_type TEXT,
  route TEXT,
  member_count INT DEFAULT 0,
  product_group TEXT,
  internal_tags TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_products_company ON products(company_id);
CREATE INDEX idx_products_group ON products(product_group);

CREATE TABLE plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  whop_plan_id TEXT UNIQUE NOT NULL,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  title TEXT,
  description TEXT,
  plan_type TEXT,
  billing_period_days INT,
  initial_price NUMERIC(10,2),
  renewal_price NUMERIC(10,2),
  trial_period_days INT,
  currency TEXT DEFAULT 'usd',
  visibility TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_plans_product ON plans(product_id);
