import Link from "next/link";
import { ArrowLeft, Mail, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCampaign } from "@/lib/mailerlite/client";
import { formatDateTime, formatRelative } from "@/lib/format";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function statusTone(
  status: string | undefined,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "sent") return "default";
  if (status === "ready") return "secondary";
  return "outline";
}

type EngagementRow = {
  event_type: string;
  clicked_url: string | null;
  occurred_at: string;
  users: { id: string; email: string | null; name: string | null } | null;
};

export default async function CampaignDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;

  const campaign = await getCampaign(id);
  const email = campaign.emails?.[0];

  const db = createAdminClient();
  const [{ data: engagementData }, { data: appCampaign }] = await Promise.all([
    db
      .from("email_events")
      .select(
        "event_type, clicked_url, occurred_at, users(id, email, name)",
      )
      .eq("mailerlite_campaign_id", id)
      .order("occurred_at", { ascending: false })
      .limit(100),
    db
      .from("campaigns")
      .select("cap_excluded_count")
      .eq("mailerlite_campaign_id", id)
      .maybeSingle(),
  ]);

  const capExcluded = (appCampaign?.cap_excluded_count as number | null) ?? 0;

  const engagement = (engagementData ?? []) as unknown as EngagementRow[];

  const counts = engagement.reduce(
    (acc, e) => {
      acc[e.event_type] = (acc[e.event_type] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-4">
        <Link
          href="/campaigns"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All campaigns
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Mail className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {campaign.name}
            </h1>
            {email?.subject && (
              <p className="mt-0.5 text-sm text-muted-foreground">
                Subject: {email.subject}
              </p>
            )}
            {email?.from && (
              <p className="text-xs text-muted-foreground">
                From: {email.from_name ? `${email.from_name} <${email.from}>` : email.from}
              </p>
            )}
          </div>
        </div>
        <Badge variant={statusTone(campaign.status)}>
          {campaign.status ?? "unknown"}
        </Badge>
      </div>

      {capExcluded > 0 && (
        <div className="mb-6 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <p className="font-medium text-amber-900 dark:text-amber-200">
              {capExcluded.toLocaleString()} user
              {capExcluded === 1 ? "" : "s"} excluded by frequency cap
            </p>
            <p className="text-xs text-amber-800/80 dark:text-amber-200/80">
              These recipients already hit the cap for this week and were
              removed from the MailerLite group before send.
            </p>
          </div>
        </div>
      )}

      <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Sent"
          value={(campaign.stats?.sent ?? 0).toLocaleString()}
        />
        <Kpi
          label="Unique opens"
          value={(campaign.stats?.unique_opens_count ?? 0).toLocaleString()}
          sub={campaign.stats?.open_rate?.string ?? "0%"}
        />
        <Kpi
          label="Unique clicks"
          value={(campaign.stats?.unique_clicks_count ?? 0).toLocaleString()}
          sub={campaign.stats?.click_rate?.string ?? "0%"}
        />
        <Kpi
          label="Unsubscribes"
          value={(campaign.stats?.unsubscribes_count ?? 0).toLocaleString()}
          sub={`${(campaign.stats?.spam_count ?? 0).toLocaleString()} spam`}
        />
      </section>

      {email?.content && (
        <Card className="mb-6">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Rendered email</CardTitle>
            <span className="text-xs text-muted-foreground">
              Sandboxed preview — same HTML MailerLite sends
            </span>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-md border bg-white">
              <iframe
                title="Email preview"
                srcDoc={email.content}
                sandbox=""
                className="h-[600px] w-full"
              />
            </div>
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                View HTML source
              </summary>
              <pre className="mt-2 max-h-96 overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-xs">
                <code>{email.content}</code>
              </pre>
            </details>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              CRM engagement ({engagement.length})
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Events the webhook captured from this campaign, joined to user
              profiles.
            </p>
          </CardHeader>
          <CardContent>
            {engagement.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No webhook events for this campaign yet.
              </p>
            ) : (
              <ul className="divide-y">
                {engagement.map((e, i) => (
                  <li
                    key={`${e.occurred_at}-${i}`}
                    className="flex items-center justify-between gap-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      {e.users ? (
                        <Link
                          href={`/users/${e.users.id}`}
                          className="truncate text-sm hover:underline"
                        >
                          {e.users.name ?? e.users.email ?? "Unknown"}
                        </Link>
                      ) : (
                        <span className="truncate text-sm text-muted-foreground">
                          Unknown
                        </span>
                      )}
                      {e.clicked_url && (
                        <p className="truncate text-xs text-muted-foreground">
                          {e.clicked_url}
                        </p>
                      )}
                    </div>
                    <Badge variant="outline">{e.event_type}</Badge>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatRelative(e.occurred_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Event breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              {Object.keys(counts).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing yet.
                </p>
              ) : (
                <dl className="space-y-1 text-sm">
                  {Object.entries(counts)
                    .sort(([, a], [, b]) => b - a)
                    .map(([type, count]) => (
                      <div
                        key={type}
                        className="flex items-center justify-between"
                      >
                        <dt className="capitalize text-muted-foreground">
                          {type}
                        </dt>
                        <dd className="tabular-nums">{count}</dd>
                      </div>
                    ))}
                </dl>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Timing</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                <TimeRow label="Created" value={campaign.created_at} />
                <TimeRow label="Scheduled for" value={campaign.scheduled_for} />
                <TimeRow label="Started" value={campaign.started_at} />
                <TimeRow label="Finished" value={campaign.finished_at} />
              </dl>
            </CardContent>
          </Card>

          {campaign.filter_for_humans &&
            campaign.filter_for_humans.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Audience</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {campaign.filter_for_humans.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
        </div>
      </div>
    </main>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardHeader className="pb-1.5">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function TimeRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">
        <div>{formatDateTime(value)}</div>
        <div className="text-xs text-muted-foreground">
          {formatRelative(value)}
        </div>
      </dd>
    </div>
  );
}
