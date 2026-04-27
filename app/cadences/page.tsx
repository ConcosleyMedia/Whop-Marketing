import Link from "next/link";
import { ArrowRight, GitBranch, Pause, Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createAdminClient } from "@/lib/supabase/admin";
import { TRIGGER_LABELS, type TriggerType } from "@/lib/cadences/types";
import { formatRelative } from "@/lib/format";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CadenceRow = {
  id: string;
  name: string;
  description: string | null;
  trigger_type: string;
  trigger_config: Record<string, unknown> | null;
  sequence_json: { steps?: unknown[] } | null;
  status: string;
  updated_at: string | null;
};

function statusTone(s: string): "default" | "secondary" | "outline" {
  if (s === "active") return "default";
  if (s === "paused") return "secondary";
  return "outline";
}

export default async function CadencesPage() {
  const db = createAdminClient();
  const [{ data: cadenceRows }, { data: enrollments }] = await Promise.all([
    db
      .from("cadences")
      .select("id, name, description, trigger_type, trigger_config, sequence_json, status, updated_at")
      .order("status", { ascending: true })
      .order("name"),
    db
      .from("cadence_enrollments")
      .select("cadence_id, status"),
  ]);

  const cadences = (cadenceRows ?? []) as CadenceRow[];
  const enrollByCadence = new Map<
    string,
    { active: number; completed: number; exited: number; total: number }
  >();
  for (const r of (enrollments ?? []) as Array<{ cadence_id: string; status: string }>) {
    const e =
      enrollByCadence.get(r.cadence_id) ??
      { active: 0, completed: 0, exited: 0, total: 0 };
    e.total++;
    if (r.status === "active") e.active++;
    else if (r.status === "completed") e.completed++;
    else if (r.status === "exited") e.exited++;
    enrollByCadence.set(r.cadence_id, e);
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Cadences</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {cadences.length} cadence{cadences.length === 1 ? "" : "s"} · automated email
          sequences triggered by events
        </p>
      </div>

      {cadences.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <GitBranch className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No cadences yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {cadences.map((c) => {
            const stats = enrollByCadence.get(c.id) ?? {
              active: 0,
              completed: 0,
              exited: 0,
              total: 0,
            };
            const stepCount = Array.isArray(c.sequence_json?.steps)
              ? c.sequence_json!.steps!.length
              : 0;
            const trig = TRIGGER_LABELS[c.trigger_type as TriggerType] ?? c.trigger_type;
            return (
              <Link href={`/cadences/${c.id}`} key={c.id} className="block">
                <Card className="h-full transition hover:border-foreground/30">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-start justify-between gap-2 text-base">
                      <span className="inline-flex min-w-0 items-start gap-1.5">
                        <GitBranch className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{c.name}</span>
                      </span>
                      <Badge variant={statusTone(c.status)}>
                        {c.status === "active" ? (
                          <Play className="mr-1 h-2.5 w-2.5 fill-current" />
                        ) : c.status === "paused" ? (
                          <Pause className="mr-1 h-2.5 w-2.5 fill-current" />
                        ) : null}
                        {c.status}
                      </Badge>
                    </CardTitle>
                    {c.description && (
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {c.description}
                      </p>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                        Trigger: {trig}
                      </span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                        {stepCount} step{stepCount === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 border-t pt-3 text-center text-xs">
                      <div>
                        <div className="font-mono text-base font-semibold tabular-nums">
                          {stats.active}
                        </div>
                        <div className="text-muted-foreground">In flight</div>
                      </div>
                      <div>
                        <div className="font-mono text-base font-semibold tabular-nums text-green-600">
                          {stats.completed}
                        </div>
                        <div className="text-muted-foreground">Completed</div>
                      </div>
                      <div>
                        <div className="font-mono text-base font-semibold tabular-nums">
                          {stats.total}
                        </div>
                        <div className="text-muted-foreground">Total</div>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
                      <span>Updated {formatRelative(c.updated_at)}</span>
                      <span className="inline-flex items-center gap-0.5 hover:text-foreground">
                        Detail
                        <ArrowRight className="h-3 w-3" />
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
