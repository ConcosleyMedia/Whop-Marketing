-- Migration 7 — Segment eligibility view
--
-- Exposes one row per user with all columns that the CRM segment builder can
-- filter on. Columns are whitelisted server-side in lib/segments/schema.ts —
-- adding a column here without adding it to that registry does nothing.

CREATE OR REPLACE VIEW segment_eligibility_view AS
WITH user_ltv AS (
  SELECT
    user_id,
    SUM(amount) AS total_ltv,
    MAX(paid_at) AS last_purchased_at
  FROM payments
  WHERE status = 'paid' AND user_id IS NOT NULL
  GROUP BY user_id
),
user_mem AS (
  SELECT
    m.user_id,
    BOOL_OR(m.status = ANY(ARRAY['active','trialing','past_due'])) AS has_active,
    STRING_AGG(
      DISTINCT CASE
        WHEN m.status = ANY(ARRAY['active','trialing','past_due']) THEN p.title
      END,
      ', '
    ) FILTER (WHERE m.status = ANY(ARRAY['active','trialing','past_due'])) AS active_products,
    STRING_AGG(DISTINCT p.title, ', ') AS ever_products
  FROM memberships m
  JOIN products p ON p.id = m.product_id
  WHERE m.user_id IS NOT NULL
  GROUP BY m.user_id
),
user_engagement AS (
  SELECT
    user_id,
    COUNT(*) FILTER (WHERE event_type = 'open'  AND occurred_at > NOW() - INTERVAL '30 days')  AS opens_30d,
    COUNT(*) FILTER (WHERE event_type = 'click' AND occurred_at > NOW() - INTERVAL '30 days')  AS clicks_30d,
    MAX(occurred_at) FILTER (WHERE event_type = 'open')  AS last_open_at,
    MAX(occurred_at) FILTER (WHERE event_type = 'click') AS last_click_at
  FROM email_events
  WHERE user_id IS NOT NULL
  GROUP BY user_id
)
SELECT
  u.id,
  u.email,
  u.name,
  u.first_seen_at,
  u.last_engagement_at,
  u.verification_status,
  u.lead_score,
  u.lead_temperature,
  u.custom_tags,
  CASE
    WHEN um.has_active THEN 'active'
    WHEN um.user_id IS NOT NULL THEN 'churned'
    ELSE 'prospect'
  END AS lifecycle_stage,
  COALESCE(ul.total_ltv, 0)::NUMERIC(10,2) AS total_ltv,
  ul.last_purchased_at,
  COALESCE(um.active_products, '') AS active_products,
  COALESCE(um.ever_products, '')   AS ever_products,
  COALESCE(ue.opens_30d, 0)  AS opens_30d,
  COALESCE(ue.clicks_30d, 0) AS clicks_30d,
  ue.last_open_at,
  ue.last_click_at
FROM users u
LEFT JOIN user_ltv        ul ON ul.user_id = u.id
LEFT JOIN user_mem        um ON um.user_id = u.id
LEFT JOIN user_engagement ue ON ue.user_id = u.id;
