import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  GitBranch,
  Mail,
  Pause,
  Play,
  UserPlus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateTime, formatRelative } from "@/lib/format";
import { TRIGGER_LABELS, type TriggerType } from "@/lib/cadences/types";
import { cn } from "@/lib/utils";
import { manualEnrollAction, setCadenceStatusAction } from "../actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type StepDef = { type: string; template_id: string; delay_hours: number };

export default async function CadenceDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { id } = await props.params;
  const sp = await props.searchParams;

  const db = createAdminClient();
  const { data: cadence } = await db
    .from("cadences")
    .select(
      "id, name, description, trigger_type, trigger_config, sequence_json, status, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (!cadence) notFound();

  const steps = ((cadence.sequence_json as { steps?: StepDef[] } | null)?.steps ?? []) as StepDef[];

  // Resolve template names for each step
  const templateIds = steps.map((s) => s.template_id);
  const { data: templates } =
    templateIds.length > 0
      ? await db.from("email_templates").select("id, name").in("id", templateIds)
      : { data: [] };
  const tplName = new Map<string, string>(
    ((templates ?? []) as Array<{ id: string; name: string }>).map((t) => [t.id, t.name]),
  );

  const { data: enrollments } = await db
    .from("cadence_enrollments")
    .select(
      "id, user_id, status, current_step, last_sent_step, enrolled_at, next_action_at, completed_at, last_send_error, users!inner(id, email, name)",
    )
    .eq("cadence_id", id)
    .order("enrolled_at", { ascending: false })
    .limit(50);
  type EnrollmentRow = {
    id: string;
    user_id: string;
    status: string;
    current_step: number;
    last_sent_step: number | null;
    enrolled_at: string | null;
    next_action_at: string | null;
    completed_at: string | null;
    last_send_error: string | null;
    users: { id: string; email: string; name: string | null } | null;
  };
  const rows = (enrollments ?? []) as unknown as EnrollmentRow[];

  const statusCounts = rows.reduce(
    (acc, e) => {
      acc[e.status] = (acc[e.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const boundEnroll = manualEnrollAction.bind(null, id);
  const boundStatus = setCadenceStatusAction.bind(null, id);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4">
        <Link
          href="/cadences"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All cadences
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{cadence.name}</h1>
            {cadence.description && (
              <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
                {cadence.description}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="default">
            {cadence.status === "active" ? (
              <Play className="mr-1 h-2.5 w-2.5 fill-current" />
            ) : (
              <Pause className="mr-1 h-2.5 w-2.5 fill-current" />
            )}
            {cadence.status}
          </Badge>
          <form action={boundStatus}>
            <input
              type="hidden"
              name="status"
              value={cadence.status === "active" ? "paused" : "active"}
            />
            <button
              type="submit"
              className={cn(
                buttonVariants({ size: "sm", variant: "outline" }),
                "h-8 gap-1.5 text-xs",
              )}
            >
              {cadence.status === "active" ? (
                <>
                  <Pause className="h-3 w-3" /> Pause
                </>
              ) : (
                <>
                  <Play className="h-3 w-3" /> Activate
                </>
              )}
            </button>
          </form>
        </div>
      </div>

      {sp.error && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {sp.error}
        </div>
      )}
      {sp.notice && (
        <div className="mb-4 rounded-md border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-300">
          {sp.notice}
        </div>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Trigger" value={TRIGGER_LABELS[cadence.trigger_type as TriggerType] ?? cadence.trigger_type} />
        <Stat label="Steps" value={String(steps.length)} />
        <Stat label="In flight" value={String(statusCounts.active ?? 0)} />
        <Stat label="Completed" value={String(statusCounts.completed ?? 0)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sequence</CardTitle>
            <p className="text-xs text-muted-foreground">
              Each step sends one email. Delay is measured from the prior step&apos;s
              send time. Day 1&apos;s delay starts from enrollment.
            </p>
          </CardHeader>
          <CardContent>
            <ol className="space-y-1.5">
              {steps.map((s, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-3 rounded border bg-background px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="font-mono text-xs font-semibold text-muted-foreground tabular-nums">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <Link
                      href={`/templates/${s.template_id}`}
                      className="truncate text-sm hover:underline"
                    >
                      {tplName.get(s.template_id) ?? "(missing template)"}
                    </Link>
                  </div>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                    {s.delay_hours === 0
                      ? "instant"
                      : s.delay_hours % 24 === 0
                        ? `+${s.delay_hours / 24}d`
                        : `+${s.delay_hours}h`}
                  </span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Manual enrollment
              </CardTitle>
              <p className="text-[11px] text-muted-foreground">
                Useful for testing. The user must already exist in the CRM.
              </p>
            </CardHeader>
            <CardContent>
              <form action={boundEnroll} className="space-y-2">
                <Label htmlFor="email" className="text-xs">
                  Email
                </Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  placeholder="kevin@brnk.studio"
                  className="h-8 text-sm"
                />
                <Button type="submit" size="sm" className="w-full gap-1.5">
                  <UserPlus className="h-3 w-3" />
                  Enroll
                </Button>
              </form>
            </CardContent>
          </Card>

          {cadence.trigger_type === "whop_membership" && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Trigger config
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-xs">
                <p className="text-muted-foreground">Plan IDs:</p>
                <ul className="font-mono">
                  {(((cadence.trigger_config as { plan_ids?: string[] }) ?? {}).plan_ids ?? []).map(
                    (p) => (
                      <li key={p} className="rounded bg-muted px-1.5 py-0.5">
                        {p}
                      </li>
                    ),
                  )}
                  {(((cadence.trigger_config as { plan_ids?: string[] }) ?? {}).plan_ids ?? []).length ===
                    0 && (
                    <li className="text-muted-foreground/70">
                      Any plan triggers
                    </li>
                  )}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">
            Enrollments ({rows.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No enrollments yet.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5">User</th>
                  <th className="px-2 py-1.5">Status</th>
                  <th className="px-2 py-1.5">Step</th>
                  <th className="px-2 py-1.5">Next</th>
                  <th className="px-2 py-1.5">Enrolled</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td className="px-2 py-2">
                      {e.users ? (
                        <Link
                          href={`/users/${e.users.id}`}
                          className="text-sm hover:underline"
                        >
                          {e.users.name ?? e.users.email}
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">unknown</span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <Badge
                        variant={
                          e.status === "active"
                            ? "secondary"
                            : e.status === "completed"
                              ? "default"
                              : "outline"
                        }
                      >
                        {e.status}
                      </Badge>
                      {e.last_send_error && (
                        <p className="mt-0.5 max-w-[260px] truncate text-[10px] text-destructive">
                          {e.last_send_error}
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-2 font-mono text-xs tabular-nums">
                      {Math.min(e.current_step + 1, steps.length)} / {steps.length}
                    </td>
                    <td
                      className="px-2 py-2 text-xs text-muted-foreground"
                      title={e.next_action_at ? formatDateTime(e.next_action_at) : ""}
                    >
                      {e.status === "completed"
                        ? "—"
                        : formatRelative(e.next_action_at)}
                    </td>
                    <td className="px-2 py-2 text-xs text-muted-foreground">
                      {formatRelative(e.enrolled_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
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
