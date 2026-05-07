// Aggregate the signals a single user needs to be scored. Five parallel
// queries against already-indexed columns. Stays well under 100ms at our
// scale (~17k users, per-user aggregates are tiny).
//
// Membership status semantics (see docs/SYSTEM.md §15 + CONTEXT.md):
//   active / trialing   → currently has access, billing is healthy
//   completed           → membership ended cleanly with access intact
//                         (lifetime products, free community pass, one-time
//                         course delivered). User still effectively a member.
//   past_due            → recurring payment failed, in grace period.
//                         Access is at risk → "canceling" lifecycle.
//   cancel_at_period_end on an active/trialing row → user clicked cancel,
//                         still has access til period end → "canceling".
//   canceled / expired  → no access; user has truly left.
//   drafted             → checkout started, never finalized. Never a member.

import type { createAdminClient } from "@/lib/supabase/admin";
import type { ScoreSignals } from "./compute";

type Db = ReturnType<typeof createAdminClient>;

// Statuses where the user effectively HAS the product right now.
// completed is here because lifetimes / free-community / one-time access
// products land in this status when delivered, and the user keeps access.
const HEALTHY_ACTIVE_STATUSES = ["active", "trialing", "completed"];

// Statuses that count as "real" memberships for the prospect/churned distinction.
// Excludes drafted (abandoned signups never made the user a member).
const REAL_MEMBERSHIP_STATUSES = [
  "active",
  "trialing",
  "completed",
  "past_due",
  "canceled",
  "expired",
];

const BOUNCE_EVENT_TYPES = ["bounced", "spam_reported", "unsubscribed"];

const DAY_MS = 86_400_000;

export async function fetchSignals(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<ScoreSignals> {
  const nowMs = now.getTime();
  const t60 = new Date(nowMs - 60 * DAY_MS).toISOString();

  const [memRes, paymentsRes, emailRes] = await Promise.all([
    db
      .from("memberships")
      .select("product_id, status, cancel_at_period_end")
      .eq("user_id", userId),
    db
      .from("payments")
      .select("status, paid_at, amount")
      .eq("user_id", userId),
    db
      .from("email_events")
      .select("event_type, occurred_at")
      .eq("user_id", userId)
      .gte("occurred_at", t60), // only need the last 60d window + lifetime flags below
  ]);

  if (memRes.error) throw new Error(`memberships: ${memRes.error.message}`);
  if (paymentsRes.error) throw new Error(`payments: ${paymentsRes.error.message}`);
  if (emailRes.error) throw new Error(`email_events: ${emailRes.error.message}`);

  // A separate cheap lookup for the two lifetime booleans — indexed by (user_id, event_type).
  const lifetimeRes = await db
    .from("email_events")
    .select("event_type, occurred_at")
    .eq("user_id", userId)
    .in("event_type", BOUNCE_EVENT_TYPES)
    .limit(1);
  if (lifetimeRes.error) throw new Error(`email_events(bounce): ${lifetimeRes.error.message}`);

  const memberships = memRes.data ?? [];
  const payments = paymentsRes.data ?? [];
  const recentEmails = emailRes.data ?? [];

  // Healthy-active: has the product, billing is fine.
  // completed never carries cancel_at_period_end; only active/trialing can.
  const healthyActiveMemberships = memberships.filter(
    (m) =>
      HEALTHY_ACTIVE_STATUSES.includes(m.status) &&
      m.cancel_at_period_end !== true,
  );

  // Canceling: still has access today, but it's going away.
  const cancelingMemberships = memberships.filter(
    (m) =>
      m.status === "past_due" ||
      ((m.status === "active" || m.status === "trialing") &&
        m.cancel_at_period_end === true),
  );

  const activeProductIds = new Set(
    [...healthyActiveMemberships, ...cancelingMemberships]
      .map((m) => m.product_id as string | null)
      .filter((id): id is string => !!id),
  );

  const hasEverRealMembership = memberships.some((m) =>
    REAL_MEMBERSHIP_STATUSES.includes(m.status),
  );

  const paidPayments = payments.filter((p) => p.status === "paid" || p.status === "succeeded");
  const totalLtv = paidPayments.reduce(
    (sum, p) => sum + Number(p.amount ?? 0),
    0,
  );
  const purchasedLast30Days = paidPayments.some(
    (p) => p.paid_at && new Date(p.paid_at).getTime() >= nowMs - 30 * DAY_MS,
  );
  const failedPaymentsLast90Days = payments.filter(
    (p) =>
      p.status === "failed" &&
      p.paid_at &&
      new Date(p.paid_at).getTime() >= nowMs - 90 * DAY_MS,
  ).length;

  // Engagement from the 60d window
  let lastOpenAt: Date | null = null;
  let lastClickAt: Date | null = null;
  let opensThisMonth = 0;
  let opensLastMonth = 0;

  for (const e of recentEmails) {
    const occurred = new Date(e.occurred_at);
    const age = nowMs - occurred.getTime();
    if (e.event_type === "opened") {
      if (!lastOpenAt || occurred > lastOpenAt) lastOpenAt = occurred;
      if (age <= 30 * DAY_MS) opensThisMonth++;
      else if (age <= 60 * DAY_MS) opensLastMonth++;
    } else if (e.event_type === "clicked") {
      if (!lastClickAt || occurred > lastClickAt) lastClickAt = occurred;
    }
  }

  const lastEngagementAt =
    lastOpenAt && lastClickAt
      ? lastOpenAt > lastClickAt
        ? lastOpenAt
        : lastClickAt
      : (lastOpenAt ?? lastClickAt);

  return {
    hasHealthyActiveMembership: healthyActiveMemberships.length > 0,
    hasCancelingMembership: cancelingMemberships.length > 0,
    hasEverRealMembership,
    purchasedLast30Days,
    lastOpenAt,
    lastClickAt,
    activeProductCount: activeProductIds.size,
    totalLtv,
    opensThisMonth,
    opensLastMonth,
    anyCancelAtPeriodEnd: cancelingMemberships.length > 0,
    lastEngagementAt,
    hasBouncedOrComplained: (lifetimeRes.data?.length ?? 0) > 0,
    failedPaymentsLast90Days,
  };
}
