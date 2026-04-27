// Aggregate the signals a single user needs to be scored. Five parallel
// queries against already-indexed columns. Stays well under 100ms at our
// scale (~17k users, per-user aggregates are tiny).

import type { createAdminClient } from "@/lib/supabase/admin";
import type { ScoreSignals } from "./compute";

type Db = ReturnType<typeof createAdminClient>;

const ACTIVE_MEMBERSHIP_STATUSES = ["active", "trialing", "past_due"];
const BOUNCE_EVENT_TYPES = ["bounced", "spam_reported", "unsubscribed"];

const DAY_MS = 86_400_000;

export async function fetchSignals(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<ScoreSignals> {
  const nowMs = now.getTime();
  const t30 = new Date(nowMs - 30 * DAY_MS).toISOString();
  const t60 = new Date(nowMs - 60 * DAY_MS).toISOString();
  const t90 = new Date(nowMs - 90 * DAY_MS).toISOString();

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

  const activeMemberships = memberships.filter((m) =>
    ACTIVE_MEMBERSHIP_STATUSES.includes(m.status),
  );
  const activeProductIds = new Set(
    activeMemberships
      .map((m) => m.product_id as string | null)
      .filter((id): id is string => !!id),
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
    hasActiveMembership: activeMemberships.length > 0,
    hasEverHadMembership: memberships.length > 0,
    purchasedLast30Days,
    lastOpenAt,
    lastClickAt,
    activeProductCount: activeProductIds.size,
    totalLtv,
    opensThisMonth,
    opensLastMonth,
    anyCancelAtPeriodEnd: activeMemberships.some((m) => m.cancel_at_period_end === true),
    lastEngagementAt,
    hasBouncedOrComplained: (lifetimeRes.data?.length ?? 0) > 0,
    failedPaymentsLast90Days,
  };
}
