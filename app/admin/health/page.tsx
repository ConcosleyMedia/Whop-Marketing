// System health dashboard. Single page that surfaces "is the brain running?"
// Shows the most recent run of every cron job + the recent failure tail.

import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateTime, formatRelative } from "@/lib/format";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Each cron job + its expected cadence. The dashboard turns red if a job hasn't
// run within (expected_interval × 2).
const JOBS: Array<{
  job: string;
  label: string;
  cadence_label: string;
  expected_interval_min: number;
  description: string;
}> = [
  {
    job: "cadences",
    label: "Cadence runner",
    cadence_label: "every 15 min",
    expected_interval_min: 15,
    description: "Sends due cadence-step emails (e.g. Build Room day 1–10).",
  },
  {
    job: "orchestrator",
    label: "Hourly orchestrator",
    cadence_label: "every 1h",
    expected_interval_min: 60,
    description:
      "Re-evaluates dynamic segments + enrolls users into segment-triggered cadences.",
  },
  {
    job: "rescore",
    label: "Lead scoring",
    cadence_label: "daily",
    expected_interval_min: 24 * 60,
    description: "Recomputes lead score / temperature / lifecycle for every user.",
  },
  {
    job: "daily-reconcile",
    label: "Daily reconcile",
    cadence_label: "daily",
    expected_interval_min: 24 * 60,
    description: "Catches drift: Whop catalog sync + MailerLite group reconcile.",
  },
];

type Run = {
  id: string;
  job: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  status: string;
  summary: unknown;
  error: string | null;
};

function staleness(
  lastRun: Run | null,
  expectedIntervalMin: number,
):
  | { tone: "ok"; label: "ok" }
  | { tone: "warn"; label: "stale" }
  | { tone: "crit"; label: "missing" } {
  if (!lastRun) return { tone: "crit", label: "missing" };
  const ageMs = Date.now() - new Date(lastRun.started_at).getTime();
  const expectedMs = expectedIntervalMin * 60_000;
  if (ageMs > expectedMs * 2) return { tone: "warn", label: "stale" };
  return { tone: "ok", label: "ok" };
}

function statusIcon(status: string) {
  if (status === "ok")
    return <CheckCircle2 className="h-4 w-4 text-green-600" />;
  if (status === "partial")
    return <AlertTriangle className="h-4 w-4 text-amber-600" />;
  if (status === "failed")
    return <XCircle className="h-4 w-4 text-destructive" />;
  return <Clock className="h-4 w-4 text-muted-foreground" />;
}

export default async function HealthPage() {
  const db = createAdminClient();

  // Most recent run per job. We pull a wider window then dedupe in JS so we
  // don't need a window function via supabase-js.
  const { data: recent } = await db
    .from("system_runs")
    .select("id, job, started_at, finished_at, duration_ms, status, summary, error")
    .order("started_at", { ascending: false })
    .limit(200);

  const lastByJob = new Map<string, Run>();
  for (const r of (recent ?? []) as Run[]) {
    if (!lastByJob.has(r.job)) lastByJob.set(r.job, r);
  }

  // Recent failures across all jobs (last 7 days)
  const failures = ((recent ?? []) as Run[])
    .filter((r) => r.status === "failed")
    .slice(0, 10);

  // Live counts: cadence enrollments by status
  const { data: cadenceCounts } = await db
    .from("cadence_enrollments")
    .select("status");
  const enrollCounts = (cadenceCounts ?? []).reduce(
    (acc, e: { status: string }) => {
      acc[e.status] = (acc[e.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  // Counts of active cadences and segments
  const [{ count: activeCadences }, { count: activeSegments }] =
    await Promise.all([
      db
        .from("cadences")
        .select("id", { count: "exact", head: true })
        .eq("status", "active"),
      db
        .from("segments")
        .select("id", { count: "exact", head: true })
        .or("is_starter_template.is.null,is_starter_template.eq.false"),
    ]);

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Activity className="h-5 w-5 text-muted-foreground" />
            System health
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Set-and-forget heartbeat. Every automated job logs here. Stale or
            missing rows = the brain isn&rsquo;t doing its job.
          </p>
        </div>
      </div>

      {/* Top stats */}
      <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Active cadences"
          value={(activeCadences ?? 0).toLocaleString()}
        />
        <Stat
          label="In-flight enrollments"
          value={(enrollCounts.active ?? 0).toLocaleString()}
        />
        <Stat
          label="Completed enrollments"
          value={(enrollCounts.completed ?? 0).toLocaleString()}
        />
        <Stat
          label="Active segments"
          value={(activeSegments ?? 0).toLocaleString()}
        />
      </section>

      {/* Cron grid */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Cron jobs</CardTitle>
          <p className="text-xs text-muted-foreground">
            All times in your local timezone. &ldquo;Stale&rdquo; means the job
            hasn&rsquo;t run within twice its expected interval.
          </p>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5">Job</th>
                <th className="px-2 py-1.5">Cadence</th>
                <th className="px-2 py-1.5">Last run</th>
                <th className="px-2 py-1.5">Status</th>
                <th className="px-2 py-1.5">Duration</th>
                <th className="px-2 py-1.5">Health</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {JOBS.map((j) => {
                const last = lastByJob.get(j.job) ?? null;
                const health = staleness(last, j.expected_interval_min);
                return (
                  <tr key={j.job} className="align-top">
                    <td className="px-2 py-2.5">
                      <div className="flex items-center gap-1.5 font-medium">
                        {statusIcon(last?.status ?? "unknown")}
                        {j.label}
                      </div>
                      <p className="mt-0.5 max-w-md text-xs text-muted-foreground">
                        {j.description}
                      </p>
                    </td>
                    <td className="px-2 py-2.5 text-xs text-muted-foreground">
                      {j.cadence_label}
                    </td>
                    <td
                      className="px-2 py-2.5 text-xs"
                      title={last ? formatDateTime(last.started_at) : ""}
                    >
                      {last ? formatRelative(last.started_at) : "—"}
                    </td>
                    <td className="px-2 py-2.5 text-xs">
                      {last ? (
                        <Badge
                          variant={
                            last.status === "ok"
                              ? "default"
                              : last.status === "partial"
                                ? "secondary"
                                : "destructive"
                          }
                        >
                          {last.status}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-xs tabular-nums text-muted-foreground">
                      {last?.duration_ms != null
                        ? `${(last.duration_ms / 1000).toFixed(1)}s`
                        : "—"}
                    </td>
                    <td className="px-2 py-2.5">
                      <Badge
                        variant={
                          health.tone === "ok"
                            ? "default"
                            : health.tone === "warn"
                              ? "secondary"
                              : "destructive"
                        }
                      >
                        {health.label}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Recent failures */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Recent failures ({failures.length})
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Most recent jobs that ended with status=&ldquo;failed&rdquo;. Empty
            here = clean.
          </p>
        </CardHeader>
        <CardContent>
          {failures.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No recent failures. ✓
            </p>
          ) : (
            <ul className="space-y-2">
              {failures.map((f) => (
                <li
                  key={f.id}
                  className="rounded border border-destructive/40 bg-destructive/5 p-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold">{f.job}</span>
                    <span className="text-muted-foreground">
                      {formatRelative(f.started_at)}
                    </span>
                  </div>
                  {f.error && (
                    <p className="mt-1 break-all text-destructive">
                      {f.error}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Looking for a cron not listed? Add it to{" "}
        <code className="rounded bg-muted px-1 font-mono">
          app/admin/health/page.tsx
        </code>{" "}
        and ensure the route wraps its body with{" "}
        <code className="rounded bg-muted px-1 font-mono">runJob()</code>.{" "}
        <Link href="/cadences" className="underline hover:text-foreground">
          Back to cadences
        </Link>
      </p>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}
