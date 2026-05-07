-- Migration 21 — Canonical lifecycle mapping (operator-defined).
--
-- Updates segment_eligibility_view to derive lifecycle_stage per the
-- domain rules in CONTEXT.md, fixing a previously-incorrect classification
-- that called every "completed" membership churned. Status mapping:
--
--   active   = has any healthy-active membership
--              (status IN ('active','trialing','completed') AND NOT cancel_at_period_end)
--              completed is here because lifetimes / free community pass /
--              one-time access products land in "completed" while the user
--              still effectively holds the product.
--   canceling = no healthy-active membership AND has access at risk
--              (past_due, OR active/trialing with cancel_at_period_end=true)
--   churned  = no healthy-active and no canceling, but has had a real
--              membership (anything except drafted)
--   prospect = no real membership ever (drafted-only or no memberships)
--
-- Also widens active_products / has_active to use the canonical "still has
-- the product" definition (HEALTHY + canceling), so a user who's mid-cancel
-- still appears under their active products until access actually ends.
--
-- DOES NOT rewrite users.lifecycle_stage — that happens via a follow-on
-- bulk rescore SQL in the same change. The view is the source of truth;
-- the column is a cached read populated by the scoring engine.
--
-- Pause Pilot 0 cadence so it can't accidentally enroll under the old
-- (broken) Free silent definition before the operator picks a new audience.

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
    -- Healthy-active: holds the product, billing isn't dying.
    BOOL_OR(
      m.status IN ('active','trialing','completed')
      AND COALESCE(m.cancel_at_period_end, false) = false
    ) AS has_healthy_active,
    -- Canceling: still has access today but it's going away.
    BOOL_OR(
      m.status = 'past_due'
      OR (m.status IN ('active','trialing') AND m.cancel_at_period_end = true)
    ) AS has_canceling,
    -- Has had any real membership (excludes drafted-only).
    BOOL_OR(m.status <> 'drafted') AS has_ever_real,
    -- Active products: healthy OR canceling — they still effectively have it.
    STRING_AGG(
      DISTINCT CASE
        WHEN m.status IN ('active','trialing','completed','past_due')
          THEN p.title
      END,
      ', '
    ) FILTER (
      WHERE m.status IN ('active','trialing','completed','past_due')
    ) AS active_products,
    -- Ever-products: only count real (non-drafted) memberships.
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

-- Backfill users.lifecycle_stage from the corrected view in one shot.
-- ~17k rows; this is fast on Postgres but unblocks segment re-evaluation.
-- The scoring cron will keep it in sync going forward.
UPDATE users u
SET lifecycle_stage = v.lifecycle_stage
FROM segment_eligibility_view v
WHERE v.id = u.id
  AND COALESCE(u.lifecycle_stage, '') <> v.lifecycle_stage;

-- Pause Pilot 0 — its segment was built against the old (broken) lifecycle
-- mapping. Operator picks a new audience post-rescore; do not auto-enroll
-- under stale assumptions in the meantime.
UPDATE cadences
SET status = 'paused'
WHERE id = '22222222-2222-2222-2222-f00000000001'
  AND status = 'active';
