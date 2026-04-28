import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  RevenueByProductChart,
  RevenueTrendChart,
  SignupsTrendChart,
} from "@/components/dashboard-charts";
import { formatMoney, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

type Membership30dForMrr = {
  plans: {
    renewal_price: number | string | null;
    billing_period_days: number | null;
  } | null;
};

type AtRiskRow = {
  id: string;
  status: string | null;
  cancel_at_period_end: boolean | null;
  renewal_period_end: string | null;
  cancellation_reason: string | null;
  products: { title: string | null } | null;
  users: { id: string; email: string | null; name: string | null } | null;
};

type RecentSignupRow = {
  id: string;
  email: string | null;
  name: string | null;
  first_seen_at: string | null;
  active_products: string | null;
  ever_products: string | null;
  total_ltv: number | string | null;
};

type RecentCancellationRow = {
  id: string;
  canceled_at: string | null;
  cancellation_reason: string | null;
  products: { title: string | null } | null;
  plans: { renewal_price: number | string | null; initial_price: number | string | null } | null;
  users: { id: string; email: string | null; name: string | null; total_ltv: number | string | null } | null;
};

function toDateKey(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  return d.toISOString().slice(0, 10);
}

function buildDailySeries<T>(
  rows: T[],
  dateOf: (row: T) => string | null,
  valueOf: (row: T) => number,
  days: number,
): { date: string; label: string; value: number }[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const raw = dateOf(row);
    if (!raw) continue;
    const key = toDateKey(raw);
    totals.set(key, (totals.get(key) ?? 0) + valueOf(row));
  }
  const out: { date: string; label: string; value: number }[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * DAY_MS);
    const key = toDateKey(d);
    out.push({
      date: key,
      label: d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      value: Math.round((totals.get(key) ?? 0) * 100) / 100,
    });
  }
  return out;
}

const PRODUCT_PERIODS = {
  "30d": { days: 30, label: "30 days" },
  "90d": { days: 90, label: "90 days" },
  all: { days: null, label: "All time" },
} as const;

type ProductPeriod = keyof typeof PRODUCT_PERIODS;
type CancelTier = "all" | "paid" | "free";

export default async function Home(props: {
  searchParams: Promise<{
    productPeriod?: string;
    signupProduct?: string;
    cancelTier?: string;
  }>;
}) {
  const sp = await props.searchParams;
  const productPeriod: ProductPeriod = (
    Object.keys(PRODUCT_PERIODS) as ProductPeriod[]
  ).includes(sp.productPeriod as ProductPeriod)
    ? (sp.productPeriod as ProductPeriod)
    : "all";
  const signupProduct = (sp.signupProduct ?? "").trim();
  const cancelTier: CancelTier = ["paid", "free", "all"].includes(
    sp.cancelTier ?? "",
  )
    ? (sp.cancelTier as CancelTier)
    : "all";

  const db = createAdminClient();
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * DAY_MS).toISOString();
  const thirtyDaysAhead = new Date(now.getTime() + 30 * DAY_MS).toISOString();

  // Build at-risk query: members with renewal_period_end in the next 30 days
  // AND either scheduled to cancel OR past_due, AND status still active-ish so
  // we don't surface long-canceled rows with stale flags.
  let atRiskQuery = db
    .from("memberships")
    .select(
      "id, status, cancel_at_period_end, renewal_period_end, cancellation_reason, products(title), users!inner(id, email, name)",
    )
    .in("status", ["active", "trialing", "past_due"])
    .or("cancel_at_period_end.eq.true,status.eq.past_due")
    .gte("renewal_period_end", now.toISOString())
    .lte("renewal_period_end", thirtyDaysAhead)
    .order("renewal_period_end", { ascending: true })
    .limit(50);

  // Recent signups query — pull 100, then narrow client-side by signupProduct
  // (active_products is a comma-joined string; using ilike at SQL level keeps
  // this query simple without recomputing distinct lists per request)
  let signupQuery = db
    .from("user_marketing_view")
    .select(
      "id, email, name, first_seen_at, active_products, ever_products, total_ltv",
    )
    .order("first_seen_at", { ascending: false, nullsFirst: false })
    .limit(100);
  if (signupProduct) {
    signupQuery = signupQuery.ilike("active_products", `%${signupProduct}%`);
  }

  const [
    activeCountRes,
    mrrRowsRes,
    revenue30Res,
    revenue90Res,
    signups90Res,
    signups30Res,
    cancellations30Res,
    paymentsByProductRes,
    atRiskRes,
    recentSignupsRes,
    recentCancellationsRes,
    usersTotalRes,
    productListRes,
  ] = await Promise.all([
    db
      .from("user_marketing_view")
      .select("id", { count: "exact", head: true })
      .eq("lifecycle_stage", "active"),
    db
      .from("memberships")
      .select("plans(renewal_price, billing_period_days)")
      .in("status", ["active", "trialing", "past_due"]),
    db
      .from("payments")
      .select("amount")
      .eq("status", "paid")
      .gte("paid_at", thirtyDaysAgo),
    db
      .from("payments_daily_view")
      .select("day, revenue")
      .gte("day", ninetyDaysAgo.slice(0, 10)),
    db
      .from("signups_daily_view")
      .select("day, signup_count")
      .gte("day", ninetyDaysAgo.slice(0, 10)),
    db
      .from("users")
      .select("id", { count: "exact", head: true })
      .gte("first_seen_at", thirtyDaysAgo),
    db
      .from("memberships")
      .select("id", { count: "exact", head: true })
      .gte("canceled_at", thirtyDaysAgo),
    db
      .from("product_revenue_aggregates_view")
      .select("product_title, revenue_30d, revenue_90d, revenue_all"),
    atRiskQuery,
    signupQuery,
    db
      .from("memberships")
      .select(
        "id, canceled_at, cancellation_reason, products(title), plans(renewal_price, initial_price), users!inner(id, email, name, total_ltv)",
      )
      .not("canceled_at", "is", null)
      .order("canceled_at", { ascending: false })
      .limit(100),
    db.from("users").select("id", { count: "exact", head: true }),
    db.from("products").select("title").eq("is_active", true).order("title"),
  ]);

  const activeCount = activeCountRes.count ?? 0;
  const usersTotal = usersTotalRes.count ?? 0;
  const signups30 = signups30Res.count ?? 0;
  const cancellations30 = cancellations30Res.count ?? 0;
  const netNew30 = signups30 - cancellations30;

  const mrrRows = (mrrRowsRes.data ?? []) as unknown as Membership30dForMrr[];
  const mrr = mrrRows.reduce((acc, m) => {
    const price = Number(m.plans?.renewal_price ?? 0);
    const days = Number(m.plans?.billing_period_days ?? 0);
    if (!Number.isFinite(price) || !Number.isFinite(days) || days <= 0)
      return acc;
    return acc + (price * 30) / days;
  }, 0);

  const revenue30 = (revenue30Res.data ?? []).reduce(
    (acc, r) => acc + Number(r.amount ?? 0),
    0,
  );

  const revenueSeries = buildDailySeries(
    revenue90Res.data ?? [],
    (r) => (r as { day: string | null }).day,
    (r) => Number((r as { revenue: number | string | null }).revenue ?? 0),
    90,
  );
  const signupsSeries = buildDailySeries(
    signups90Res.data ?? [],
    (r) => (r as { day: string | null }).day,
    (r) => Number((r as { signup_count: number | string }).signup_count ?? 0),
    90,
  );

  const revenueColumnByPeriod: Record<
    ProductPeriod,
    "revenue_30d" | "revenue_90d" | "revenue_all"
  > = {
    "30d": "revenue_30d",
    "90d": "revenue_90d",
    all: "revenue_all",
  };
  const revenueColumn = revenueColumnByPeriod[productPeriod];
  const revenueByProduct = (
    (paymentsByProductRes.data ?? []) as Array<{
      product_title: string | null;
      revenue_30d: number | string | null;
      revenue_90d: number | string | null;
      revenue_all: number | string | null;
    }>
  )
    .map((row) => ({
      product: row.product_title?.trim() || "(unknown)",
      revenue: Math.round(Number(row[revenueColumn] ?? 0)),
    }))
    .filter((r) => r.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);

  const atRisk = (atRiskRes.data ?? []) as unknown as AtRiskRow[];
  const recentSignupsAll =
    (recentSignupsRes.data ?? []) as unknown as RecentSignupRow[];
  const recentCancellationsAll =
    (recentCancellationsRes.data ?? []) as unknown as RecentCancellationRow[];

  // Apply cancel-tier filter (paid = LTV>0; free = LTV==0 AND no plan price)
  const recentCancellations = recentCancellationsAll.filter((m) => {
    const ltv = Number(m.users?.total_ltv ?? 0);
    const planPrice = Number(
      m.plans?.renewal_price ?? m.plans?.initial_price ?? 0,
    );
    const isPaid = ltv > 0 || planPrice > 0;
    if (cancelTier === "paid") return isPaid;
    if (cancelTier === "free") return !isPaid;
    return true;
  });

  const productList = (
    (productListRes.data ?? []) as Array<{ title: string | null }>
  )
    .map((p) => p.title?.trim() ?? "")
    .filter(Boolean);

  const cancelCounts = {
    all: recentCancellationsAll.length,
    paid: recentCancellationsAll.filter((m) => {
      const ltv = Number(m.users?.total_ltv ?? 0);
      const planPrice = Number(
        m.plans?.renewal_price ?? m.plans?.initial_price ?? 0,
      );
      return ltv > 0 || planPrice > 0;
    }).length,
    free: recentCancellationsAll.filter((m) => {
      const ltv = Number(m.users?.total_ltv ?? 0);
      const planPrice = Number(
        m.plans?.renewal_price ?? m.plans?.initial_price ?? 0,
      );
      return !(ltv > 0 || planPrice > 0);
    }).length,
  };

  // Wrapper styles: Whoop-style dark cinematic, scoped to this page only.
  // The global nav above stays its normal light theme.
  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-zinc-950 text-zinc-100">
      <main className="mx-auto max-w-7xl space-y-5 px-4 py-8">
        {/* Header */}
        <header className="flex items-end justify-between border-b border-zinc-800/80 pb-5">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-lime-400">
              · DASHBOARD ·
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">
              Whop CRM
            </h1>
            <p className="mt-1 text-xs text-zinc-500">
              {usersTotal.toLocaleString()} customers tracked · Whop +
              MailerLite live
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              · NOW
            </p>
            <p className="mt-1 font-mono text-xs text-zinc-400">
              {new Date().toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
        </header>

        {/* Big stat row */}
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <BigStat
            label="MRR"
            value={formatMoney(mrr)}
            sub="from active memberships"
            accent="lime"
          />
          <BigStat
            label="Active members"
            value={activeCount.toLocaleString()}
            sub={`${Math.round(
              (activeCount / Math.max(1, usersTotal)) * 100,
            )}% of total`}
            accent="cyan"
            ring={Math.round((activeCount / Math.max(1, usersTotal)) * 100)}
          />
          <BigStat
            label="Net new (30d)"
            value={`${netNew30 >= 0 ? "+" : ""}${netNew30.toLocaleString()}`}
            sub={`${signups30} joined · ${cancellations30} churned`}
            accent={netNew30 >= 0 ? "lime" : "rose"}
            trend={netNew30 >= 0 ? "up" : "down"}
          />
          <BigStat
            label="Revenue (30d)"
            value={formatMoney(revenue30)}
            sub={`${(revenue30Res.data ?? []).length.toLocaleString()} payments`}
            accent="violet"
          />
        </section>

        {/* Charts */}
        <section className="grid gap-3 lg:grid-cols-2">
          <DarkCard
            title="Revenue · last 90 days"
            meta={`${formatMoney(
              revenueSeries.reduce((a, r) => a + r.value, 0),
            )} total`}
          >
            <RevenueTrendChart data={revenueSeries} />
          </DarkCard>

          <DarkCard
            title="Signups · last 90 days"
            meta={`${signupsSeries
              .reduce((a, r) => a + r.value, 0)
              .toLocaleString()} total`}
          >
            <SignupsTrendChart data={signupsSeries} />
          </DarkCard>
        </section>

        {/* At Risk + Revenue by product */}
        <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <DarkCard
            title={
              <span className="inline-flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                At risk · ending in next 30 days
              </span>
            }
            meta={`${atRisk.length} member${atRisk.length === 1 ? "" : "s"}`}
            scroll
          >
            {atRisk.length === 0 ? (
              <DarkEmpty>Nothing on fire right now.</DarkEmpty>
            ) : (
              <ul className="divide-y divide-zinc-800/80">
                {atRisk.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/users/${m.users?.id}`}
                        className="truncate text-sm font-medium text-zinc-100 hover:text-lime-400"
                      >
                        {m.users?.name ?? m.users?.email ?? "Unknown"}
                      </Link>
                      <p className="truncate text-xs text-zinc-500">
                        {m.products?.title ?? "—"} ·{" "}
                        {m.cancel_at_period_end
                          ? "scheduled to cancel"
                          : m.status}
                      </p>
                    </div>
                    <div className="text-right font-mono text-[11px] text-amber-400">
                      {m.renewal_period_end
                        ? `ends ${formatRelative(m.renewal_period_end)}`
                        : "—"}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </DarkCard>

          <DarkCard
            title="Revenue by product"
            meta={
              <div className="flex gap-0.5 rounded-md border border-zinc-800 bg-zinc-900 p-0.5 text-[10px]">
                {(Object.keys(PRODUCT_PERIODS) as ProductPeriod[]).map(
                  (key) => {
                    const params = new URLSearchParams();
                    if (key !== "all") params.set("productPeriod", key);
                    if (signupProduct) params.set("signupProduct", signupProduct);
                    if (cancelTier !== "all") params.set("cancelTier", cancelTier);
                    return (
                      <Link
                        key={key}
                        href={`/?${params.toString()}`}
                        className={cn(
                          "rounded px-2 py-0.5 text-zinc-400 transition hover:text-zinc-100",
                          productPeriod === key &&
                            "bg-zinc-800 text-zinc-100",
                        )}
                        scroll={false}
                      >
                        {PRODUCT_PERIODS[key].label}
                      </Link>
                    );
                  },
                )}
              </div>
            }
          >
            {revenueByProduct.length === 0 ? (
              <DarkEmpty>
                No paid revenue in{" "}
                {PRODUCT_PERIODS[productPeriod].label.toLowerCase()}.
              </DarkEmpty>
            ) : (
              <RevenueByProductChart data={revenueByProduct} />
            )}
          </DarkCard>
        </section>

        {/* Signups + Cancellations */}
        <section className="grid gap-3 lg:grid-cols-2">
          <DarkCard
            title={
              <span className="inline-flex items-center gap-2">
                <TrendingUp className="h-3.5 w-3.5 text-lime-400" />
                Recent signups
              </span>
            }
            meta={
              <ProductFilter
                value={signupProduct}
                products={productList}
                productPeriod={productPeriod}
                cancelTier={cancelTier}
              />
            }
            scroll
          >
            {recentSignupsAll.length === 0 ? (
              <DarkEmpty>
                No signups{" "}
                {signupProduct
                  ? `for "${signupProduct}"`
                  : "yet"}
                .
              </DarkEmpty>
            ) : (
              <ul className="divide-y divide-zinc-800/80">
                {recentSignupsAll.map((u) => {
                  const products = u.active_products || u.ever_products || "";
                  const ltv = Number(u.total_ltv ?? 0);
                  return (
                    <li
                      key={u.id}
                      className="flex items-center justify-between py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/users/${u.id}`}
                          className="truncate text-sm font-medium text-zinc-100 hover:text-lime-400"
                        >
                          {u.name ?? u.email ?? "Unknown"}
                        </Link>
                        {products && (
                          <p className="truncate text-[11px] text-zinc-500">
                            {products}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 pl-3 text-right">
                        {ltv > 0 && (
                          <span className="block font-mono text-[11px] text-lime-400">
                            {formatMoney(ltv)}
                          </span>
                        )}
                        <span className="block font-mono text-[10px] text-zinc-500">
                          {formatRelative(u.first_seen_at)}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </DarkCard>

          <DarkCard
            title={
              <span className="inline-flex items-center gap-2">
                <TrendingDown className="h-3.5 w-3.5 text-rose-400" />
                Recent cancellations
              </span>
            }
            meta={
              <CancelTierTabs
                value={cancelTier}
                counts={cancelCounts}
                productPeriod={productPeriod}
                signupProduct={signupProduct}
              />
            }
            scroll
          >
            {recentCancellations.length === 0 ? (
              <DarkEmpty>
                No {cancelTier !== "all" && `${cancelTier} `}cancellations.
              </DarkEmpty>
            ) : (
              <ul className="divide-y divide-zinc-800/80">
                {recentCancellations.map((m) => {
                  const ltv = Number(m.users?.total_ltv ?? 0);
                  const planPrice = Number(
                    m.plans?.renewal_price ?? m.plans?.initial_price ?? 0,
                  );
                  const isPaid = ltv > 0 || planPrice > 0;
                  return (
                    <li
                      key={m.id}
                      className="flex items-center justify-between py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <Link
                            href={`/users/${m.users?.id}`}
                            className="truncate text-sm font-medium text-zinc-100 hover:text-lime-400"
                          >
                            {m.users?.name ?? m.users?.email ?? "Unknown"}
                          </Link>
                          {isPaid && (
                            <span className="rounded bg-lime-400/10 px-1 py-0.5 font-mono text-[9px] uppercase tracking-wide text-lime-400">
                              paid
                            </span>
                          )}
                        </div>
                        <p className="truncate text-[11px] text-zinc-500">
                          {m.products?.title ?? "—"}
                          {m.cancellation_reason
                            ? ` · ${m.cancellation_reason}`
                            : ""}
                        </p>
                      </div>
                      <div className="shrink-0 pl-3 text-right">
                        {ltv > 0 && (
                          <span className="block font-mono text-[11px] text-rose-300">
                            {formatMoney(ltv)} lost
                          </span>
                        )}
                        <span className="block font-mono text-[10px] text-zinc-500">
                          {formatRelative(m.canceled_at)}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </DarkCard>
        </section>

        <div className="border-t border-zinc-800/80 pt-5">
          <Link
            href="/users"
            className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-lime-400"
          >
            Browse all users
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </main>
    </div>
  );
}

function BigStat({
  label,
  value,
  sub,
  trend,
  accent = "lime",
  ring,
}: {
  label: string;
  value: string;
  sub?: string;
  trend?: "up" | "down";
  accent?: "lime" | "cyan" | "violet" | "rose";
  ring?: number; // 0-100
}) {
  const Trend =
    trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : null;
  const accentClass =
    accent === "lime"
      ? "text-lime-400"
      : accent === "cyan"
        ? "text-cyan-400"
        : accent === "violet"
          ? "text-violet-400"
          : "text-rose-400";
  const ringStrokeColor =
    accent === "lime"
      ? "#a3e635"
      : accent === "cyan"
        ? "#22d3ee"
        : accent === "violet"
          ? "#a78bfa"
          : "#fb7185";

  return (
    <div className="relative overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/60 p-5 transition hover:border-zinc-700">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            {label}
          </p>
          <div
            className={cn(
              "mt-2 flex items-center gap-1.5 text-3xl font-bold tabular-nums",
              accentClass,
            )}
          >
            {Trend && <Trend className="h-5 w-5" />}
            {value}
          </div>
          {sub && (
            <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-zinc-500">
              {sub}
            </p>
          )}
        </div>
        {typeof ring === "number" && (
          <RingGauge value={Math.min(100, ring)} color={ringStrokeColor} />
        )}
      </div>
      {/* Subtle accent gradient bar */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 h-px",
          accent === "lime" && "bg-gradient-to-r from-transparent via-lime-400/40 to-transparent",
          accent === "cyan" && "bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent",
          accent === "violet" && "bg-gradient-to-r from-transparent via-violet-400/40 to-transparent",
          accent === "rose" && "bg-gradient-to-r from-transparent via-rose-400/40 to-transparent",
        )}
      />
    </div>
  );
}

function RingGauge({ value, color }: { value: number; color: string }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const dash = (value / 100) * c;
  return (
    <div className="relative flex h-14 w-14 shrink-0 items-center justify-center">
      <svg viewBox="0 0 56 56" className="h-14 w-14 -rotate-90">
        <circle
          cx="28"
          cy="28"
          r={r}
          fill="none"
          stroke="rgba(82, 82, 91, 0.4)"
          strokeWidth="3"
        />
        <circle
          cx="28"
          cy="28"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeDasharray={`${dash} ${c}`}
          strokeLinecap="round"
        />
      </svg>
      <span className="absolute font-mono text-[10px] tabular-nums text-zinc-300">
        {value}%
      </span>
    </div>
  );
}

function DarkCard({
  title,
  meta,
  children,
  scroll,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  children: React.ReactNode;
  scroll?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/60">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800/80 px-4 py-2.5">
        <h2 className="text-sm font-semibold tracking-tight text-zinc-100">
          {title}
        </h2>
        {meta && (
          <div className="font-mono text-[10px] uppercase tracking-wide text-zinc-500">
            {meta}
          </div>
        )}
      </div>
      <div className={cn("px-4 py-3", scroll && "max-h-[420px] overflow-y-auto")}>
        {children}
      </div>
    </div>
  );
}

function DarkEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-8 text-center text-xs text-zinc-500">{children}</p>
  );
}

function ProductFilter({
  value,
  products,
  productPeriod,
  cancelTier,
}: {
  value: string;
  products: string[];
  productPeriod: ProductPeriod;
  cancelTier: CancelTier;
}) {
  // Server component; can't use onChange. Render as small <select> wrapped
  // in a form that auto-submits. Browser GET form posts the chosen option
  // back as ?signupProduct=...
  return (
    <form className="flex items-center gap-1">
      {productPeriod !== "all" && (
        <input type="hidden" name="productPeriod" value={productPeriod} />
      )}
      {cancelTier !== "all" && (
        <input type="hidden" name="cancelTier" value={cancelTier} />
      )}
      <select
        name="signupProduct"
        defaultValue={value}
        className="h-6 rounded border border-zinc-700 bg-zinc-900 px-1.5 font-mono text-[10px] uppercase tracking-wide text-zinc-300 outline-none hover:border-zinc-600 focus:border-lime-400/50"
      >
        <option value="">All products</option>
        {products.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-zinc-400 hover:border-lime-400/50 hover:text-lime-400"
      >
        Filter
      </button>
    </form>
  );
}

function CancelTierTabs({
  value,
  counts,
  productPeriod,
  signupProduct,
}: {
  value: CancelTier;
  counts: { all: number; paid: number; free: number };
  productPeriod: ProductPeriod;
  signupProduct: string;
}) {
  const buildHref = (tier: CancelTier) => {
    const params = new URLSearchParams();
    if (productPeriod !== "all") params.set("productPeriod", productPeriod);
    if (signupProduct) params.set("signupProduct", signupProduct);
    if (tier !== "all") params.set("cancelTier", tier);
    return `/?${params.toString()}`;
  };
  const tiers: Array<{ key: CancelTier; label: string }> = [
    { key: "all", label: "All" },
    { key: "paid", label: "Paid" },
    { key: "free", label: "Free" },
  ];
  return (
    <div className="flex gap-0.5 rounded-md border border-zinc-800 bg-zinc-900 p-0.5 text-[10px]">
      {tiers.map((t) => (
        <Link
          key={t.key}
          href={buildHref(t.key)}
          className={cn(
            "rounded px-1.5 py-0.5 font-mono uppercase tracking-wide text-zinc-400 transition hover:text-zinc-100",
            value === t.key && "bg-zinc-800 text-zinc-100",
          )}
          scroll={false}
        >
          {t.label}
          <span className="ml-1 tabular-nums opacity-50">
            {counts[t.key]}
          </span>
        </Link>
      ))}
    </div>
  );
}
