import Link from "next/link";
import { ArrowLeft, Filter } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSegment, listSegmentSubscribers } from "@/lib/mailerlite/client";
import { formatMoney, formatRelative } from "@/lib/format";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function lifecycleTone(
  stage: string | null,
): "default" | "secondary" | "destructive" | "outline" {
  if (stage === "active") return "default";
  if (stage === "churned") return "destructive";
  return "secondary";
}

export default async function SegmentDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { id } = await props.params;
  const sp = await props.searchParams;

  const [segment, subsPage] = await Promise.all([
    getSegment(id),
    listSegmentSubscribers(id, { limit: 50, cursor: sp.cursor }),
  ]);

  const subscribers = subsPage.subscribers;
  const emails = subscribers.map((s) => s.email).filter(Boolean);

  const db = createAdminClient();
  const crmRowsRes =
    emails.length > 0
      ? await db
          .from("user_marketing_view")
          .select(
            "id, email, lifecycle_stage, total_ltv, active_products",
          )
          .in("email", emails)
      : {
          data: [] as Array<{
            id: string;
            email: string;
            lifecycle_stage: string | null;
            total_ltv: number | string | null;
            active_products: string | null;
          }>,
        };
  const crmByEmail = new Map<
    string,
    {
      id: string;
      lifecycle_stage: string | null;
      total_ltv: number | string | null;
      active_products: string | null;
    }
  >();
  for (const r of crmRowsRes.data ?? []) {
    if (r.email) {
      crmByEmail.set(r.email.toLowerCase(), {
        id: r.id as string,
        lifecycle_stage: r.lifecycle_stage as string | null,
        total_ltv: r.total_ltv as number | string | null,
        active_products: r.active_products as string | null,
      });
    }
  }

  const matched = emails.filter((e) => crmByEmail.has(e.toLowerCase())).length;

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-4">
        <Link
          href="/segments/mailerlite"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All MailerLite segments
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Filter className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {segment.name}
            </h1>
            <p className="text-sm text-muted-foreground">
              {(segment.total ?? 0).toLocaleString()} subscribers
              {segment.created_at &&
                ` · created ${formatRelative(segment.created_at)}`}
            </p>
          </div>
        </div>
      </div>

      <section className="mb-6 grid gap-3 sm:grid-cols-3">
        <Kpi
          label="Subscribers"
          value={(segment.total ?? 0).toLocaleString()}
        />
        <Kpi label="Open rate" value={segment.open_rate?.string ?? "—"} />
        <Kpi label="Click rate" value={segment.click_rate?.string ?? "—"} />
      </section>

      <div className="mb-3 flex items-center justify-end text-xs text-muted-foreground">
        {matched} of {subscribers.length} on this page match a CRM user
      </div>

      <div className="rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-muted-foreground">
            <tr>
              <Th>Email</Th>
              <Th>Lifecycle</Th>
              <Th>LTV</Th>
              <Th>Active products</Th>
              <Th>Opens</Th>
              <Th>Clicks</Th>
              <Th>Subscribed</Th>
            </tr>
          </thead>
          <tbody>
            {subscribers.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="py-12 text-center text-sm text-muted-foreground"
                >
                  No subscribers with this status.
                </td>
              </tr>
            ) : (
              subscribers.map((s) => {
                const crm = crmByEmail.get(s.email.toLowerCase());
                return (
                  <tr
                    key={s.id}
                    className="border-b last:border-b-0 hover:bg-muted/30"
                  >
                    <td className="px-3 py-2">
                      {crm ? (
                        <Link
                          href={`/users/${crm.id}`}
                          className="font-medium hover:underline"
                        >
                          {s.email}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">{s.email}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {crm ? (
                        <Badge variant={lifecycleTone(crm.lifecycle_stage)}>
                          {crm.lifecycle_stage ?? "unknown"}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {crm ? formatMoney(crm.total_ltv) : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {crm?.active_products || "—"}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {s.opens_count ?? 0}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {s.clicks_count ?? 0}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {formatRelative(s.subscribed_at ?? null)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {subsPage.nextCursor && (
        <div className="mt-4 flex justify-end">
          <Link
            href={`/segments/mailerlite/${id}?cursor=${subsPage.nextCursor}`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Next page
          </Link>
        </div>
      )}
    </main>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-1.5">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left font-medium text-xs uppercase tracking-wide">
      {children}
    </th>
  );
}
