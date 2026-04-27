// Pure scoring function. No DB, no side effects — takes aggregated signals,
// returns a score/temperature/lifecycle plus a breakdown of which rules fired.
//
// Lifecycle is derived the same way `segment_eligibility_view` does it:
//   - has any active-ish membership → "active"
//   - has ever had a membership     → "churned"
//   - otherwise                     → "prospect"
//
// Score is clamped 0..100. Temperature falls out of fixed buckets in weights.ts.

import {
  TEMPERATURE_BUCKETS,
  WEIGHTS,
  type Lifecycle,
  type Temperature,
  type WeightKey,
} from "./weights";

export type ScoreSignals = {
  hasActiveMembership: boolean;
  hasEverHadMembership: boolean;
  purchasedLast30Days: boolean;
  lastOpenAt: Date | null;
  lastClickAt: Date | null;
  activeProductCount: number;
  totalLtv: number;
  opensThisMonth: number;
  opensLastMonth: number;
  anyCancelAtPeriodEnd: boolean;
  lastEngagementAt: Date | null;
  hasBouncedOrComplained: boolean;
  failedPaymentsLast90Days: number;
};

export type ScoreBreakdownEntry = {
  rule: WeightKey;
  points: number;
};

export type ScoreResult = {
  leadScore: number;
  leadTemperature: Temperature;
  lifecycleStage: Lifecycle;
  breakdown: ScoreBreakdownEntry[];
};

const MS_PER_DAY = 86_400_000;

function daysSince(d: Date | null, now: number): number | null {
  if (!d) return null;
  return (now - d.getTime()) / MS_PER_DAY;
}

export function computeScore(
  signals: ScoreSignals,
  now: Date = new Date(),
): ScoreResult {
  const nowMs = now.getTime();
  const breakdown: ScoreBreakdownEntry[] = [];

  const add = (rule: WeightKey, condition: boolean, multiplier = 1) => {
    if (!condition) return;
    const pts = WEIGHTS[rule] * multiplier;
    if (pts === 0) return;
    breakdown.push({ rule, points: pts });
  };

  // Positive signals
  add("has_active_paid_membership", signals.hasActiveMembership);
  add("purchased_last_30_days", signals.purchasedLast30Days);

  const dSinceOpen = daysSince(signals.lastOpenAt, nowMs);
  add(
    "opened_email_last_7_days",
    dSinceOpen !== null && dSinceOpen <= 7,
  );

  const dSinceClick = daysSince(signals.lastClickAt, nowMs);
  add(
    "clicked_email_last_14_days",
    dSinceClick !== null && dSinceClick <= 14,
  );

  add("on_multiple_products", signals.activeProductCount >= 2);
  add("ltv_over_500", signals.totalLtv > 500);
  add(
    "positive_engagement_trend",
    signals.opensThisMonth > signals.opensLastMonth,
  );

  // Negative signals
  add("cancel_at_period_end", signals.anyCancelAtPeriodEnd);

  const dSinceEngagement = daysSince(signals.lastEngagementAt, nowMs);
  add(
    "no_engagement_30_days",
    dSinceEngagement === null || dSinceEngagement > 30,
  );

  add("bounced_or_complained", signals.hasBouncedOrComplained);
  add(
    "failed_payment_90_days",
    signals.failedPaymentsLast90Days > 0,
    signals.failedPaymentsLast90Days,
  );

  const raw = breakdown.reduce((sum, b) => sum + b.points, 0);
  const leadScore = Math.max(0, Math.min(100, raw));

  const leadTemperature: Temperature =
    TEMPERATURE_BUCKETS.find((b) => leadScore >= b.min)?.temp ?? "at_risk";

  const lifecycleStage: Lifecycle = signals.hasActiveMembership
    ? "active"
    : signals.hasEverHadMembership
      ? "churned"
      : "prospect";

  return { leadScore, leadTemperature, lifecycleStage, breakdown };
}
