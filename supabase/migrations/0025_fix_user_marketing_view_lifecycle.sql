-- Migration 25 — Apply canonical lifecycle mapping to user_marketing_view.
--
-- Migration 0021 fixed segment_eligibility_view but missed
-- user_marketing_view, which has its own duplicated lifecycle derivation.
-- The /users, /groups/[id], dashboard, and MailerLite-segment pages all
-- read from this view, so until now they kept showing free-AutomationFlow
-- members as `churned` (because the old logic treated status='completed'
-- as ex-membership).
--
-- Applies the same rules as 0021 (CONTEXT.md is canonical):
--   active    = healthy active/trialing/completed, no cancel_at_period_end
--   canceling = past_due, OR active/trialing + cancel_at_period_end=true
--   churned   = canceled or expired (real ex-customers, no current access)
--   prospect  = drafted-only or no memberships
--
-- Also widens active_products to include status IN
-- ('active','trialing','completed','past_due') so users still effectively
-- holding a product (lifetimes, free-community completed) appear under
-- their active products on the user 360 / group views.

CREATE OR REPLACE VIEW user_marketing_view AS
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
)
SELECT
  u.id,
  u.whop_user_id,
  u.email,
  u.first_seen_at,
  CASE
    WHEN um.has_healthy_active THEN 'active'
    WHEN um.has_canceling      THEN 'canceling'
    WHEN um.has_ever_real      THEN 'churned'
    ELSE 'prospect'
  END AS lifecycle_stage,
  COALESCE(ul.total_ltv, 0::numeric) AS total_ltv,
  ul.last_purchased_at,
  COALESCE(um.active_products, '') AS active_products,
  COALESCE(um.ever_products, '')   AS ever_products,
  u.name,
  u.username,
  u.last_engagement_at,
  u.verification_status
FROM users u
LEFT JOIN user_ltv ul ON ul.user_id = u.id
LEFT JOIN user_mem um ON um.user_id = u.id;
