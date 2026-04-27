-- Migration 8 — Seed starter segment templates
--
-- Templates live in the same `segments` table flagged with
-- is_starter_template=true. The list page filters them out; /segments/new
-- surfaces them as a "start from template" picker that pre-fills the
-- builder with the template's rules.
--
-- Filter JSON must match lib/segments/schema.ts — fields and ops are
-- whitelisted by FilterJsonSchema at runtime.

INSERT INTO segments (name, description, filter_json, is_dynamic, is_starter_template, member_count)
VALUES
  (
    'Active high-LTV',
    'Current paying customers with lifetime value at or above $100. Good for VIP perks, early-access offers, and upsell campaigns.',
    '{"match":"all","rules":[{"field":"lifecycle_stage","op":"eq","value":"active"},{"field":"total_ltv","op":"gte","value":100}]}'::jsonb,
    true, true, 0
  ),
  (
    'Recent signups',
    'Users who appeared in Whop within the last 30 days. Use for onboarding sequences and first-purchase incentives.',
    '{"match":"all","rules":[{"field":"first_seen_at","op":"lt_days_ago","value":30}]}'::jsonb,
    true, true, 0
  ),
  (
    'At-risk: recently churned',
    'Customers who churned within the last 30 days — a small enough window that win-back offers still feel timely.',
    '{"match":"all","rules":[{"field":"lifecycle_stage","op":"eq","value":"churned"},{"field":"last_purchased_at","op":"lt_days_ago","value":60}]}'::jsonb,
    true, true, 0
  ),
  (
    'Lapsed buyers',
    'Previously paid but last purchase was more than 90 days ago and they are no longer active. Candidates for re-engagement.',
    '{"match":"all","rules":[{"field":"lifecycle_stage","op":"eq","value":"churned"},{"field":"last_purchased_at","op":"gt_days_ago","value":90}]}'::jsonb,
    true, true, 0
  ),
  (
    'Email hygiene: risky addresses',
    'Addresses flagged risky, invalid, or disposable by MailerCheck. Exclude from campaigns to protect sender reputation.',
    '{"match":"any","rules":[{"field":"verification_status","op":"eq","value":"invalid"},{"field":"verification_status","op":"eq","value":"risky"},{"field":"verification_status","op":"eq","value":"disposable"}]}'::jsonb,
    true, true, 0
  ),
  (
    'Engaged non-buyers',
    'Opened an email in the last 30 days but never paid. Warm prospects for a conversion push.',
    '{"match":"all","rules":[{"field":"opens_30d","op":"gte","value":1},{"field":"total_ltv","op":"lte","value":0}]}'::jsonb,
    true, true, 0
  );
