// Daily reconcile job. Runs slower drift-correction work that doesn't need to
// happen every hour:
//
//   1. Whop incremental sync: catches any membership/payment events the live
//      webhook missed (network blips, deploys, replays). Calls the existing
//      `syncProductsAndPlans` to refresh the catalog and a recent-window
//      memberships sync to backfill activity.
//
//   2. CRM → MailerLite group reconcile: any CRM segment that has been
//      previously synced to MailerLite gets re-synced so removals / additions
//      flow through. (For v1 we don't store the synced group_id on segments
//      so this is a no-op until that schema lands.)
//
//   3. (Future) Cleanup of stale per-user cadence groups (`crm-user-*`) for
//      users who finished or exited every cadence > 30 days ago.

import type { createAdminClient } from "@/lib/supabase/admin";
import {
  syncMemberships,
  syncPayments,
  syncProductsAndPlans,
} from "@/lib/whop/sync";

type Db = ReturnType<typeof createAdminClient>;

export type DailySummary = {
  whop_catalog_synced: boolean;
  whop_catalog_error: string | null;
  whop_products_upserted?: number;
  whop_plans_upserted?: number;

  whop_memberships_synced: number;
  whop_memberships_error: string | null;
  whop_users_upserted: number;

  whop_payments_synced: number;
  whop_payments_error: string | null;

  group_sync_skipped: boolean;
  cleanup_skipped: boolean;
};

// Daily reconcile job. Runs slower drift-correction work that doesn't need to
// happen every hour:
//
//   1. Whop products + plans catalog sync (fast — small set).
//   2. Whop memberships full sync — catches status changes (cancellations,
//      renewals, plan switches) that webhooks would normally deliver. If
//      Whop's webhook ever fails / lags, this is the safety net.
//   3. Whop payments full sync — same reasoning for revenue events.
//   4. (Future) CRM → MailerLite group reconcile + cleanup of stale per-user
//      cadence groups.
//
// All three Whop syncs are upserts on whop_*_id, so re-running is idempotent.
// They iterate the entire dataset, which is acceptable at our scale (~25k
// memberships, ~9k payments) and runs within the 300s function budget.
export async function runDailyReconcile(db: Db): Promise<{
  status: "ok" | "partial";
  summary: DailySummary;
}> {
  const summary: DailySummary = {
    whop_catalog_synced: false,
    whop_catalog_error: null,
    whop_memberships_synced: 0,
    whop_memberships_error: null,
    whop_users_upserted: 0,
    whop_payments_synced: 0,
    whop_payments_error: null,
    group_sync_skipped: true,
    cleanup_skipped: true,
  };

  // 1. Catalog (small, fast).
  try {
    const result = await syncProductsAndPlans();
    summary.whop_catalog_synced = true;
    summary.whop_products_upserted = (result as { products?: number }).products;
    summary.whop_plans_upserted = (result as { plans?: number }).plans;
  } catch (err) {
    summary.whop_catalog_error = err instanceof Error ? err.message : String(err);
  }

  // 2. Memberships (catches status changes webhooks may have missed).
  try {
    const memResult = await syncMemberships();
    summary.whop_memberships_synced = memResult.memberships_synced;
    summary.whop_users_upserted = memResult.users_upserted;
  } catch (err) {
    summary.whop_memberships_error =
      err instanceof Error ? err.message : String(err);
  }

  // 3. Payments.
  try {
    const payResult = await syncPayments();
    summary.whop_payments_synced = payResult.payments_synced;
  } catch (err) {
    summary.whop_payments_error =
      err instanceof Error ? err.message : String(err);
  }

  void db;

  const status =
    summary.whop_catalog_error ||
    summary.whop_memberships_error ||
    summary.whop_payments_error
      ? "partial"
      : "ok";
  return { status, summary };
}
