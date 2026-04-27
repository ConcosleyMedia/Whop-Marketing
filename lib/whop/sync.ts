import { createAdminClient } from "@/lib/supabase/admin";
import { getWhopClient, getWhopCompanyId } from "./client";

type Db = ReturnType<typeof createAdminClient>;

export type ProductsPlansResult = {
  company_id: string;
  products_synced: number;
  plans_synced: number;
  started_at: string;
  finished_at: string;
};

export type MembershipsResult = {
  memberships_synced: number;
  users_upserted: number;
  skipped_no_email: number;
  skipped_unknown_product: number;
  skipped_unknown_plan: number;
  started_at: string;
  finished_at: string;
};

export type PaymentsResult = {
  payments_synced: number;
  skipped_unknown_membership: number;
  skipped_no_amount: number;
  started_at: string;
  finished_at: string;
};

const BATCH_SIZE = 100;

function toIso(val: string | null | undefined): string | null {
  if (!val) return null;
  if (/^\d+$/.test(val)) {
    const n = parseInt(val, 10);
    return new Date(n < 1e11 ? n * 1000 : n).toISOString();
  }
  return val;
}

async function loadMap(
  db: Db,
  table: "products" | "plans" | "users" | "memberships",
  whopKey: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await db
      .from(table)
      .select(`id, ${whopKey}`)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`load ${table} map failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data as unknown as Array<Record<string, string>>) {
      map.set(row[whopKey], row.id);
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return map;
}

export async function syncProductsAndPlans(): Promise<ProductsPlansResult> {
  const started_at = new Date().toISOString();
  const whop = getWhopClient();
  const whopCompanyId = getWhopCompanyId();
  const db = createAdminClient();

  const company = await whop.companies.retrieve(whopCompanyId);

  const { data: companyRow, error: companyErr } = await db
    .from("companies")
    .upsert(
      { whop_company_id: company.id, title: company.title, updated_at: new Date().toISOString() },
      { onConflict: "whop_company_id" },
    )
    .select("id")
    .single();
  if (companyErr) throw new Error(`companies upsert failed: ${companyErr.message}`);
  const companyUuid = companyRow.id as string;

  let products_synced = 0;
  const productIdMap = new Map<string, string>();

  for await (const p of whop.products.list({ company_id: whopCompanyId })) {
    const { data: row, error } = await db
      .from("products")
      .upsert(
        {
          whop_product_id: p.id,
          company_id: companyUuid,
          title: p.title,
          headline: p.headline,
          visibility: p.visibility,
          route: p.route,
          member_count: p.member_count,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "whop_product_id" },
      )
      .select("id, whop_product_id")
      .single();
    if (error) throw new Error(`products upsert failed (${p.id}): ${error.message}`);
    productIdMap.set(row.whop_product_id as string, row.id as string);
    products_synced++;
  }

  let plans_synced = 0;
  for await (const pl of whop.plans.list({ company_id: whopCompanyId })) {
    const whopProductId = pl.product?.id;
    const productUuid = whopProductId ? productIdMap.get(whopProductId) : null;
    if (!productUuid) continue;

    const { error } = await db.from("plans").upsert(
      {
        whop_plan_id: pl.id,
        product_id: productUuid,
        title: pl.title,
        description: pl.description,
        plan_type: pl.plan_type,
        billing_period_days: pl.billing_period,
        initial_price: pl.initial_price,
        renewal_price: pl.renewal_price,
        trial_period_days: pl.trial_period_days,
        currency: pl.currency,
        visibility: pl.visibility,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "whop_plan_id" },
    );
    if (error) throw new Error(`plans upsert failed (${pl.id}): ${error.message}`);
    plans_synced++;
  }

  return {
    company_id: companyUuid,
    products_synced,
    plans_synced,
    started_at,
    finished_at: new Date().toISOString(),
  };
}

type MembershipItem = {
  id: string;
  status: string;
  created_at: string;
  updated_at: string;
  canceled_at: string | null;
  joined_at: string | null;
  renewal_period_end: string | null;
  renewal_period_start: string | null;
  cancel_at_period_end: boolean;
  cancel_option: string | null;
  cancellation_reason: string | null;
  plan: { id: string };
  product: { id: string };
  promo_code: { id: string } | null;
  user: { id: string; email: string | null; name: string | null; username: string } | null;
};

export async function syncMemberships(): Promise<MembershipsResult> {
  const started_at = new Date().toISOString();
  const whop = getWhopClient();
  const whopCompanyId = getWhopCompanyId();
  const db = createAdminClient();

  const productMap = await loadMap(db, "products", "whop_product_id");
  const planMap = await loadMap(db, "plans", "whop_plan_id");
  const userMap = await loadMap(db, "users", "whop_user_id");

  let memberships_synced = 0;
  let users_upserted = 0;
  let skipped_no_email = 0;
  let skipped_unknown_product = 0;
  let skipped_unknown_plan = 0;

  let batch: MembershipItem[] = [];

  const flush = async () => {
    if (batch.length === 0) return;

    const newUserRows = new Map<string, Record<string, unknown>>();
    for (const m of batch) {
      if (!m.user || !m.user.email) continue;
      if (userMap.has(m.user.id)) continue;
      if (newUserRows.has(m.user.id)) continue;
      newUserRows.set(m.user.id, {
        whop_user_id: m.user.id,
        email: m.user.email,
        name: m.user.name,
        username: m.user.username,
        first_seen_at: toIso(m.joined_at) ?? m.created_at,
        updated_at: new Date().toISOString(),
      });
    }
    if (newUserRows.size > 0) {
      const { data, error } = await db
        .from("users")
        .upsert(Array.from(newUserRows.values()), { onConflict: "whop_user_id" })
        .select("id, whop_user_id");
      if (error) throw new Error(`users upsert failed: ${error.message}`);
      for (const row of data as Array<{ id: string; whop_user_id: string }>) {
        userMap.set(row.whop_user_id, row.id);
      }
      users_upserted += data.length;
    }

    const rows: Record<string, unknown>[] = [];
    for (const m of batch) {
      if (!m.user || !m.user.email) {
        skipped_no_email++;
        continue;
      }
      const user_id = userMap.get(m.user.id);
      const product_id = productMap.get(m.product.id);
      const plan_id = planMap.get(m.plan.id);
      if (!product_id) {
        skipped_unknown_product++;
        continue;
      }
      if (!plan_id) {
        skipped_unknown_plan++;
        continue;
      }
      rows.push({
        whop_membership_id: m.id,
        user_id,
        product_id,
        plan_id,
        status: m.status,
        joined_at: toIso(m.joined_at),
        canceled_at: toIso(m.canceled_at),
        renewal_period_start: toIso(m.renewal_period_start),
        renewal_period_end: toIso(m.renewal_period_end),
        cancel_at_period_end: m.cancel_at_period_end,
        cancel_option: m.cancel_option,
        cancellation_reason: m.cancellation_reason,
        promo_code_id: m.promo_code?.id ?? null,
        updated_at: new Date().toISOString(),
      });
    }
    if (rows.length > 0) {
      const { error } = await db
        .from("memberships")
        .upsert(rows, { onConflict: "whop_membership_id" });
      if (error) throw new Error(`memberships upsert failed: ${error.message}`);
      memberships_synced += rows.length;
    }
    batch = [];
  };

  for await (const m of whop.memberships.list({ company_id: whopCompanyId })) {
    batch.push(m as unknown as MembershipItem);
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();

  return {
    memberships_synced,
    users_upserted,
    skipped_no_email,
    skipped_unknown_product,
    skipped_unknown_plan,
    started_at,
    finished_at: new Date().toISOString(),
  };
}

type PaymentItem = {
  id: string;
  total: number | null;
  amount_after_fees: number;
  currency: string | null;
  status: string | null;
  substatus: string | null;
  paid_at: string | null;
  refunded_at: string | null;
  dispute_alerted_at: string | null;
  user: { id: string; email: string | null; name: string | null; username: string } | null;
  membership: { id: string } | null;
  product: { id: string } | null;
  plan: { id: string } | null;
};

export async function syncPayments(): Promise<PaymentsResult> {
  const started_at = new Date().toISOString();
  const whop = getWhopClient();
  const whopCompanyId = getWhopCompanyId();
  const db = createAdminClient();

  const productMap = await loadMap(db, "products", "whop_product_id");
  const planMap = await loadMap(db, "plans", "whop_plan_id");
  const userMap = await loadMap(db, "users", "whop_user_id");
  const membershipMap = await loadMap(db, "memberships", "whop_membership_id");

  let payments_synced = 0;
  let skipped_unknown_membership = 0;
  let skipped_no_amount = 0;

  let batch: PaymentItem[] = [];

  const flush = async () => {
    if (batch.length === 0) return;

    const rows: Record<string, unknown>[] = [];
    for (const p of batch) {
      const amount = p.total ?? p.amount_after_fees;
      if (amount == null) {
        skipped_no_amount++;
        continue;
      }
      const membership_id = p.membership ? membershipMap.get(p.membership.id) : null;
      if (p.membership && !membership_id) {
        skipped_unknown_membership++;
        continue;
      }
      rows.push({
        whop_payment_id: p.id,
        user_id: p.user ? userMap.get(p.user.id) ?? null : null,
        membership_id: membership_id ?? null,
        product_id: p.product ? productMap.get(p.product.id) ?? null : null,
        plan_id: p.plan ? planMap.get(p.plan.id) ?? null : null,
        amount,
        currency: p.currency ?? "usd",
        status: p.status ?? "unknown",
        substatus: p.substatus,
        paid_at: toIso(p.paid_at),
        refunded_at: toIso(p.refunded_at),
        dispute_alerted_at: toIso(p.dispute_alerted_at),
        updated_at: new Date().toISOString(),
      });
    }
    if (rows.length > 0) {
      const { error } = await db
        .from("payments")
        .upsert(rows, { onConflict: "whop_payment_id" });
      if (error) throw new Error(`payments upsert failed: ${error.message}`);
      payments_synced += rows.length;
    }
    batch = [];
  };

  for await (const p of whop.payments.list({ company_id: whopCompanyId })) {
    batch.push(p as unknown as PaymentItem);
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();

  return {
    payments_synced,
    skipped_unknown_membership,
    skipped_no_amount,
    started_at,
    finished_at: new Date().toISOString(),
  };
}
