// Lifecycle-stage tests. Score math is exercised indirectly here too, but
// the focus is the operator-canonical lifecycle rules (CONTEXT.md):
//   completed → active, drafted-only → prospect, cancel_at_period_end →
//   canceling, past_due → canceling, canceled/expired → churned.

import { describe, it, expect } from "vitest";
import { computeScore, type ScoreSignals } from "./compute";

const baseSignals: ScoreSignals = {
  hasHealthyActiveMembership: false,
  hasCancelingMembership: false,
  hasEverRealMembership: false,
  purchasedLast30Days: false,
  lastOpenAt: null,
  lastClickAt: null,
  activeProductCount: 0,
  totalLtv: 0,
  opensThisMonth: 0,
  opensLastMonth: 0,
  anyCancelAtPeriodEnd: false,
  lastEngagementAt: null,
  hasBouncedOrComplained: false,
  failedPaymentsLast90Days: 0,
};

describe("computeScore — lifecycle derivation", () => {
  it("active when user has a healthy-active membership (e.g. completed lifetime)", () => {
    const r = computeScore({ ...baseSignals, hasHealthyActiveMembership: true });
    expect(r.lifecycleStage).toBe("active");
  });

  it("active wins over canceling when both are true (multi-membership user)", () => {
    const r = computeScore({
      ...baseSignals,
      hasHealthyActiveMembership: true,
      hasCancelingMembership: true,
    });
    expect(r.lifecycleStage).toBe("active");
  });

  it("canceling when only the canceling signal is set (cancel_at_period_end or past_due)", () => {
    const r = computeScore({
      ...baseSignals,
      hasCancelingMembership: true,
      hasEverRealMembership: true,
    });
    expect(r.lifecycleStage).toBe("canceling");
  });

  it("churned when user had a real membership but no current access", () => {
    const r = computeScore({ ...baseSignals, hasEverRealMembership: true });
    expect(r.lifecycleStage).toBe("churned");
  });

  it("prospect when user has no real memberships (drafted-only or none at all)", () => {
    const r = computeScore({ ...baseSignals });
    expect(r.lifecycleStage).toBe("prospect");
  });
});
