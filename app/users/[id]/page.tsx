import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, Mail, User as UserIcon } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ActivityTimeline,
  type TimelineActivity,
} from "@/components/activity-timeline";
import { formatDate, formatDateTime, formatMoney, formatRelative } from "@/lib/format";

export const dynamic = "force-dynamic";

function lifecycleTone(
  stage: string | null,
): "default" | "secondary" | "destructive" | "outline" {
  if (stage === "active") return "default";
  if (stage === "churned") return "destructive";
  return "secondary";
}

type MembershipRow = {
  id: string;
  status: string | null;
  joined_at: string | null;
  canceled_at: string | null;
  renewal_period_end: string | null;
  cancel_at_period_end: boolean | null;
  cancellation_reason: string | null;
  total_spent_on_membership: number | string | null;
  products: { title: string | null } | null;
  plans: {
    title: string | null;
    renewal_price: number | string | null;
    currency: string | null;
    billing_period_days: number | null;
  } | null;
};

export default async function UserDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const db = createAdminClient();

  const [userRes, marketingRes] = await Promise.all([
    db
      .from("users")
      .select(
        "id, email, name, username, whop_user_id, lead_score, lead_temperature, first_seen_at, last_engagement_at, verification_status, verification_suggestion, mailerlite_subscriber_id, created_at",
      )
      .eq("id", id)
      .maybeSingle(),
    db
      .from("user_marketing_view")
      .select("lifecycle_stage, total_ltv, last_purchased_at")
      .eq("id", id)
      .maybeSingle(),
  ]);
  if (userRes.error) throw new Error(`user query failed: ${userRes.error.message}`);
  if (!userRes.data) notFound();
  const user = userRes.data;
  const marketing = marketingRes.data ?? null;

  const [membershipsRes, activitiesRes, paymentsRes] = await Promise.all([
    db
      .from("memberships")
      .select(
        "id, status, joined_at, canceled_at, renewal_period_end, cancel_at_period_end, cancellation_reason, total_spent_on_membership, products(title), plans(title, renewal_price, currency, billing_period_days)",
      )
      .eq("user_id", id)
      .order("joined_at", { ascending: false }),
    db
      .from("activities")
      .select(
        "id, activity_type, title, description, metadata, occurred_at",
      )
      .eq("user_id", id)
      .order("occurred_at", { ascending: false })
      .limit(200),
    db
      .from("payments")
      .select("amount, currency, status, paid_at", { count: "exact" })
      .eq("user_id", id)
      .order("paid_at", { ascending: false })
      .limit(1),
  ]);
  if (membershipsRes.error)
    throw new Error(`memberships: ${membershipsRes.error.message}`);
  if (activitiesRes.error)
    throw new Error(`activities: ${activitiesRes.error.message}`);
  if (paymentsRes.error)
    throw new Error(`payments: ${paymentsRes.error.message}`);

  const memberships = (membershipsRes.data ?? []) as unknown as MembershipRow[];
  const activities = (activitiesRes.data ?? []) as unknown as TimelineActivity[];
  const paymentCount = paymentsRes.count ?? 0;
  const lastPayment = paymentsRes.data?.[0] ?? null;

  const displayName =
    (user.name as string | null) ?? (user.username as string | null) ?? null;
  const email = (user.email as string | null) ?? null;

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-4">
        <Link
          href="/users"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All users
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <UserIcon className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {displayName ?? email ?? "Unknown user"}
              </h1>
              {email && displayName ? (
                <p className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Mail className="h-3.5 w-3.5" />
                  {email}
                </p>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={lifecycleTone(marketing?.lifecycle_stage as string | null)}>
            {(marketing?.lifecycle_stage as string | null) ?? "unknown"}
          </Badge>
          {user.verification_status === "valid" && (
            <Badge variant="outline" className="gap-1">
              <CheckCircle2 className="h-3 w-3" />
              verified
            </Badge>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Lifetime value
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">
              {formatMoney(marketing?.total_ltv as number | null)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {paymentCount.toLocaleString()} payment
              {paymentCount === 1 ? "" : "s"}
              {lastPayment?.paid_at
                ? ` · last ${formatRelative(lastPayment.paid_at as string)}`
                : ""}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              First seen
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-medium">
              {formatDate(user.first_seen_at as string | null)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatRelative(user.first_seen_at as string | null)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Last activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-medium">
              {formatDate(user.last_engagement_at as string | null)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatRelative(user.last_engagement_at as string | null)}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_minmax(0,360px)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityTimeline items={activities} />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Memberships ({memberships.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {memberships.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No memberships.
                </p>
              ) : (
                memberships.map((m) => (
                  <div
                    key={m.id}
                    className="rounded-md border p-3 text-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {m.products?.title ?? "Unknown product"}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {m.plans?.title ?? "—"}
                        </p>
                      </div>
                      <Badge
                        variant={
                          m.status === "active" ? "default" : "secondary"
                        }
                      >
                        {m.status ?? "unknown"}
                      </Badge>
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <dt>Joined</dt>
                      <dd className="text-right text-foreground">
                        {formatDate(m.joined_at)}
                      </dd>
                      {m.canceled_at && (
                        <>
                          <dt>Canceled</dt>
                          <dd className="text-right text-foreground">
                            {formatDate(m.canceled_at)}
                          </dd>
                        </>
                      )}
                      {m.renewal_period_end && m.status === "active" && (
                        <>
                          <dt>Renews</dt>
                          <dd className="text-right text-foreground">
                            {formatDate(m.renewal_period_end)}
                          </dd>
                        </>
                      )}
                      <dt>Spent</dt>
                      <dd className="text-right text-foreground tabular-nums">
                        {formatMoney(
                          m.total_spent_on_membership as number | null,
                        )}
                      </dd>
                    </dl>
                    {m.cancellation_reason && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Reason: {m.cancellation_reason}
                      </p>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                <DetailRow label="Whop user ID" value={user.whop_user_id as string | null} mono />
                {user.username && (
                  <DetailRow
                    label="Username"
                    value={`@${user.username as string}`}
                  />
                )}
                {user.mailerlite_subscriber_id && (
                  <DetailRow
                    label="MailerLite ID"
                    value={user.mailerlite_subscriber_id as string}
                    mono
                  />
                )}
                {user.verification_status && (
                  <DetailRow
                    label="Email"
                    value={user.verification_status as string}
                  />
                )}
                {user.verification_suggestion && (
                  <DetailRow
                    label="Suggested"
                    value={user.verification_suggestion as string}
                  />
                )}
                {user.lead_score != null && (
                  <DetailRow
                    label="Lead score"
                    value={String(user.lead_score)}
                  />
                )}
                {user.lead_temperature && (
                  <DetailRow
                    label="Temperature"
                    value={user.lead_temperature as string}
                  />
                )}
                <DetailRow
                  label="Record created"
                  value={formatDateTime(user.created_at as string | null)}
                />
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={
          mono
            ? "max-w-[60%] truncate font-mono text-xs"
            : "max-w-[60%] truncate"
        }
      >
        {value}
      </dd>
    </div>
  );
}
