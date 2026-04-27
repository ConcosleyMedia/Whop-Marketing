// Lead-scoring weights. Hardcoded here so changes go through code review and
// can't silently drift from the temperature buckets below. The same values
// are seeded into the `scoring_config` table (migration 0005) so the DB has a
// human-readable record — but scoring reads from this file, not the DB.
//
// If you tune weights, also bump WEIGHTS_VERSION so downstream systems
// (activity log, cached scores in other tables) can invalidate.

export const WEIGHTS_VERSION = 1;

export type WeightKey =
  | "has_active_paid_membership"
  | "purchased_last_30_days"
  | "opened_email_last_7_days"
  | "clicked_email_last_14_days"
  | "on_multiple_products"
  | "ltv_over_500"
  | "positive_engagement_trend"
  | "cancel_at_period_end"
  | "no_engagement_30_days"
  | "bounced_or_complained"
  | "failed_payment_90_days";

export const WEIGHTS: Record<WeightKey, number> = {
  has_active_paid_membership: 20,
  purchased_last_30_days: 15,
  opened_email_last_7_days: 10,
  clicked_email_last_14_days: 10,
  on_multiple_products: 5,
  ltv_over_500: 15,
  positive_engagement_trend: 10,
  cancel_at_period_end: -20,
  no_engagement_30_days: -15,
  bounced_or_complained: -10,
  failed_payment_90_days: -5, // per failure
};

// Temperature buckets (inclusive lower bound). Order matters — evaluate high → low.
export const TEMPERATURE_BUCKETS = [
  { min: 80, temp: "hot" as const },
  { min: 50, temp: "warm" as const },
  { min: 20, temp: "cold" as const },
  { min: 0, temp: "at_risk" as const },
];

export type Temperature = (typeof TEMPERATURE_BUCKETS)[number]["temp"];
export type Lifecycle = "prospect" | "active" | "churned";
