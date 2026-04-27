import { createAdminClient } from "@/lib/supabase/admin";

type Db = ReturnType<typeof createAdminClient>;

export function toIso(val: string | null | undefined): string | null {
  if (!val) return null;
  if (/^\d+$/.test(val)) {
    const n = parseInt(val, 10);
    return new Date(n < 1e11 ? n * 1000 : n).toISOString();
  }
  return val;
}

async function resolveId(
  db: Db,
  table: "products" | "plans" | "users" | "memberships",
  whopKey: string,
  whopValue: string | null | undefined,
): Promise<string | null> {
  if (!whopValue) return null;
  const { data, error } = await db
    .from(table)
    .select("id")
    .eq(whopKey, whopValue)
    .maybeSingle();
  if (error) throw new Error(`lookup ${table}(${whopValue}) failed: ${error.message}`);
  return (data?.id as string) ?? null;
}

type MembershipShape = {
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

export type UpsertMembershipResult = {
  membership_id: string | null;
  user_id: string | null;
  skipped_reason?: "no_user_email" | "unknown_product" | "unknown_plan";
};

export async function upsertMembership(
  db: Db,
  m: MembershipShape,
): Promise<UpsertMembershipResult> {
  if (!m.user || !m.user.email) {
    return { membership_id: null, user_id: null, skipped_reason: "no_user_email" };
  }
  const product_id = await resolveId(db, "products", "whop_product_id", m.product.id);
  if (!product_id) {
    return { membership_id: null, user_id: null, skipped_reason: "unknown_product" };
  }
  const plan_id = await resolveId(db, "plans", "whop_plan_id", m.plan.id);
  if (!plan_id) {
    return { membership_id: null, user_id: null, skipped_reason: "unknown_plan" };
  }

  const { data: userRow, error: userErr } = await db
    .from("users")
    .upsert(
      {
        whop_user_id: m.user.id,
        email: m.user.email,
        name: m.user.name,
        username: m.user.username,
        first_seen_at: toIso(m.joined_at) ?? m.created_at,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "whop_user_id" },
    )
    .select("id")
    .single();
  if (userErr) throw new Error(`user upsert failed: ${userErr.message}`);
  const user_id = userRow.id as string;

  const { data: memRow, error: memErr } = await db
    .from("memberships")
    .upsert(
      {
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
      },
      { onConflict: "whop_membership_id" },
    )
    .select("id")
    .single();
  if (memErr) throw new Error(`membership upsert failed: ${memErr.message}`);
  return { membership_id: memRow.id as string, user_id };
}

type PaymentShape = {
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

export type UpsertPaymentResult = {
  payment_id: string | null;
  user_id: string | null;
  skipped_reason?: "no_amount";
};

export async function upsertPayment(
  db: Db,
  p: PaymentShape,
): Promise<UpsertPaymentResult> {
  const amount = p.total ?? p.amount_after_fees;
  if (amount == null) {
    return { payment_id: null, user_id: null, skipped_reason: "no_amount" };
  }

  const [membership_id, product_id, plan_id, user_id] = await Promise.all([
    resolveId(db, "memberships", "whop_membership_id", p.membership?.id),
    resolveId(db, "products", "whop_product_id", p.product?.id),
    resolveId(db, "plans", "whop_plan_id", p.plan?.id),
    resolveId(db, "users", "whop_user_id", p.user?.id),
  ]);

  const { data, error } = await db
    .from("payments")
    .upsert(
      {
        whop_payment_id: p.id,
        user_id,
        membership_id,
        product_id,
        plan_id,
        amount,
        currency: p.currency ?? "usd",
        status: p.status ?? "unknown",
        substatus: p.substatus,
        paid_at: toIso(p.paid_at),
        refunded_at: toIso(p.refunded_at),
        dispute_alerted_at: toIso(p.dispute_alerted_at),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "whop_payment_id" },
    )
    .select("id")
    .single();
  if (error) throw new Error(`payment upsert failed: ${error.message}`);
  return { payment_id: data.id as string, user_id };
}

export async function writeActivity(
  db: Db,
  row: {
    user_id: string | null;
    activity_type: string;
    title: string;
    description?: string | null;
    related_entity_type?: string;
    related_entity_id?: string | null;
    metadata?: Record<string, unknown>;
    occurred_at: string;
  },
): Promise<void> {
  if (!row.user_id) return;
  const { error } = await db.from("activities").insert({
    user_id: row.user_id,
    activity_type: row.activity_type,
    title: row.title,
    description: row.description ?? null,
    related_entity_type: row.related_entity_type ?? null,
    related_entity_id: row.related_entity_id ?? null,
    metadata: row.metadata ?? {},
    occurred_at: row.occurred_at,
  });
  if (error) throw new Error(`activity insert failed: ${error.message}`);
}
