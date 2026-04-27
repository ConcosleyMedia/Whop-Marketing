import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  TrendingDown,
  TrendingUp,
  Users as UsersIcon,
} from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

type RecentSignup = {
  id: string;
  email: string | null;
  name: string | null;
  first_seen_at: string | null;
  active_products: string | null;
  ever_products: string | null;
};

type RecentCancellation = {
  id: string;
  canceled_at: string | null;
  cancellation_reason: string | null;
  products: { title: string | null } | null;
  users: { id: string; email: string | null; name: string | null } | null;
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

export default async function Home(props: {
  searchParams: Promise<{ productPeriod?: string }>;
}) {
  const sp = await props.searchParams;
  const productPeriod: ProductPeriod = (
    Object.keys(PRODUCT_PERIODS) as ProductPeriod[]
  ).includes(sp.productPeriod as ProductPeriod)
    ? (sp.productPeriod as ProductPeriod)
    : "all";
  const db = createAdminClient();
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * DAY_MS).toISOString();

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
    db
      .from("memberships")
      .select(
        "id, status, cancel_at_period_end, renewal_period_end, cancellation_reason, products(title), users!inner(id, email, name)",
      )
      .or("cancel_at_period_end.eq.true,status.eq.past_due")
      .not("renewal_period_end", "is", null)
      .order("renewal_period_end", { ascending: true })
      .limit(5),
    db
      .from("user_marketing_view")
      .select("id, email, name, first_seen_at, active_products, ever_products")
      .order("first_seen_at", { ascending: false, nullsFirst: false })
      .limit(5),
    db
      .from("memberships")
      .select(
        "id, canceled_at, cancellation_reason, products(title), users(id, email, name)",
      )
      .not("canceled_at", "is", null)
      .order("canceled_at", { ascending: false })
      .limit(5),
    db.from("users").select("id", { count: "exact", head: true }),
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

  const revenueColumnByPeriod: Record<ProductPeriod, "revenue_30d" | "revenue_90d" | "revenue_all"> = {
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
  const recentSignups = (recentSignupsRes.data ?? []) as unknown as RecentSignup[];
  const recentCancellations =
    (recentCancellationsRes.data ?? []) as unknown as RecentCancellation[];

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {usersTotal.toLocaleString()} customers · Whop + MailerLite
          </p>
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="MRR" value={formatMoney(mrr)} sub="from active memberships" />
        <Kpi
          label="Active members"
          value={activeCount.toLocaleString()}
          sub={`${Math.round((activeCount / Math.max(1, usersTotal)) * 100)}% of total`}
        />
        <Kpi
          label="Net new (30d)"
          value={`${netNew30 >= 0 ? "+" : ""}${netNew30.toLocaleString()}`}
          sub={`${signups30} joined · ${cancellations30} churned`}
          trend={netNew30 >= 0 ? "up" : "down"}
        />
        <Kpi
          label="Revenue (30d)"
          value={formatMoney(revenue30)}
          sub={`${(revenue30Res.data ?? []).length.toLocaleString()} payments`}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm font-medium">
              <span>Revenue · last 90 days</span>
              <span className="text-xs font-normal text-muted-foreground">
                {formatMoney(revenueSeries.reduce((a, r) => a + r.value, 0))}{" "}
                total
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pl-2">
            <RevenueTrendChart data={revenueSeries} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm font-medium">
              <span>Signups · last 90 days</span>
              <span className="text-xs font-normal text-muted-foreground">
                {signupsSeries.reduce((a, r) => a + r.value, 0).toLocaleString()}{" "}
                total
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pl-2">
            <SignupsTrendChart data={signupsSeries} />
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              At risk
              <span className="text-xs font-normal text-muted-foreground">
                scheduled to cancel or past due
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {atRisk.length === 0 ? (
              <EmptyState>Nothing on fire right now.</EmptyState>
            ) : (
              <ul className="divide-y">
                {atRisk.map((m) => (
                  <li key={m.id} className="flex items-center justify-between py-2.5">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/users/${m.users?.id}`}
                        className="truncate text-sm font-medium hover:underline"
                      >
                        {m.users?.name ?? m.users?.email ?? "Unknown"}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {m.products?.title ?? "—"} ·{" "}
                        {m.cancel_at_period_end ? "scheduled to cancel" : m.status}
                      </p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      {m.renewal_period_end
                        ? `ends ${formatRelative(m.renewal_period_end)}`
                        : "—"}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm font-medium">
              <span>Revenue by product</span>
              <div className="flex gap-0.5 rounded-md border p-0.5 text-xs font-normal">
                {(Object.keys(PRODUCT_PERIODS) as ProductPeriod[]).map((key) => (
                  <Link
                    key={key}
                    href={key === "all" ? "/" : `/?productPeriod=${key}`}
                    className={cn(
                      "rounded px-2 py-0.5 text-muted-foreground hover:text-foreground",
                      productPeriod === key &&
                        "bg-muted text-foreground",
                    )}
                    scroll={false}
                  >
                    {PRODUCT_PERIODS[key].label}
                  </Link>
                ))}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {revenueByProduct.length === 0 ? (
              <EmptyState>
                No paid revenue in {PRODUCT_PERIODS[productPeriod].label.toLowerCase()}.
              </EmptyState>
            ) : (
              <RevenueByProductChart data={revenueByProduct} />
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              Recent signups
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentSignups.length === 0 ? (
              <EmptyState>No signups yet.</EmptyState>
            ) : (
              <ul className="divide-y">
                {recentSignups.map((u) => {
                  const products = u.active_products || u.ever_products || "";
                  return (
                    <li
                      key={u.id}
                      className="flex items-center justify-between py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/users/${u.id}`}
                          className="truncate text-sm font-medium hover:underline"
                        >
                          {u.name ?? u.email ?? "Unknown"}
                        </Link>
                        {products && (
                          <p className="truncate text-xs text-muted-foreground">
                            {products}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatRelative(u.first_seen_at)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <TrendingDown className="h-4 w-4 text-red-500" />
              Recent cancellations
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentCancellations.length === 0 ? (
              <EmptyState>No cancellations yet.</EmptyState>
            ) : (
              <ul className="divide-y">
                {recentCancellations.map((m) => (
                  <li key={m.id} className="flex items-center justify-between py-2.5">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/users/${m.users?.id}`}
                        className="truncate text-sm font-medium hover:underline"
                      >
                        {m.users?.name ?? m.users?.email ?? "Unknown"}
                      </Link>
                      {m.cancellation_reason && (
                        <p className="truncate text-xs text-muted-foreground">
                          {m.cancellation_reason}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatRelative(m.canceled_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      <div className="pt-2">
        <Link
          href="/users"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <UsersIcon className="h-4 w-4" />
          Browse all users
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </main>
  );
}

function Kpi({
  label,
  value,
  sub,
  trend,
}: {
  label: string;
  value: string;
  sub?: string;
  trend?: "up" | "down";
}) {
  const Trend =
    trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : null;
  return (
    <Card>
      <CardHeader className="pb-1.5">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className={cn(
            "flex items-center gap-2 text-2xl font-semibold tabular-nums",
            trend === "up" && "text-emerald-600",
            trend === "down" && "text-red-600",
          )}
        >
          {Trend && <Trend className="h-5 w-5" />}
          {value}
        </div>
        {sub && (
          <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>
  );
}
