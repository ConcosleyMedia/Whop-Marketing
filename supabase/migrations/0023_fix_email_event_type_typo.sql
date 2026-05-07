-- Migration 23 — Fix event_type typo in segment_eligibility_view.
--
-- The original view (migration 0007) — and migration 0021 which preserved
-- the typo when rewriting the lifecycle logic — filtered email_events by
-- event_type='open' and event_type='click'. The actual values stored in
-- email_events are 'opened' and 'clicked' (per the MailerLite webhook
-- handler and SYSTEM.md §2). Result: opens_30d / clicks_30d /
-- last_open_at / last_click_at were always 0/null, breaking any segment
-- filter that referenced them ("Engaged non-buyers" etc).
--
-- The lead-scoring engine (lib/scoring/fetch.ts) was unaffected — it
-- already checks event_type === "opened" / "clicked" correctly.

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
    BOOL_OR(
      m.status IN ('active','trialing','completed')
      AND COALESCE(m.cancel_at_period_end, false) = false
    ) AS has_healthy_active,
    BOOL_OR(
      m.status = 'past_due'
      OR (m.status IN ('active','trialing') AND m.cancel_at_period_end = true)
    ) AS has_canceling,
    BOOL_OR(m.status <> 'drafted') AS has_ever_real,
    STRING_AGG(
      DISTINCT CASE
        WHEN m.status IN ('active','trialing','completed','past_due')
          THEN p.title
      END,
      ', '
    ) FILTER (
      WHERE m.status IN ('active','trialing','completed','past_due')
    ) AS active_products,
    STRING_AGG(DISTINCT p.title, ', ')
      FILTER (WHERE m.status <> 'drafted') AS ever_products
  FROM memberships m
  JOIN products p ON p.id = m.product_id
  WHERE m.user_id IS NOT NULL
  GROUP BY m.user_id
),
user_engagement AS (
  SELECT
    user_id,
    COUNT(*) FILTER (WHERE event_type = 'opened'  AND occurred_at > NOW() - INTERVAL '30 days') AS opens_30d,
    COUNT(*) FILTER (WHERE event_type = 'clicked' AND occurred_at > NOW() - INTERVAL '30 days') AS clicks_30d,
    MAX(occurred_at) FILTER (WHERE event_type = 'opened')  AS last_open_at,
    MAX(occurred_at) FILTER (WHERE event_type = 'clicked') AS last_click_at
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
    WHEN um.has_healthy_active        THEN 'active'
    WHEN um.has_canceling             THEN 'canceling'
    WHEN um.has_ever_real             THEN 'churned'
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
