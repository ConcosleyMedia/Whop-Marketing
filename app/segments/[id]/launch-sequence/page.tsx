import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Rocket } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { CadenceSequence } from "@/lib/cadences/types";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { attachCadenceToSegmentAction } from "@/app/segments/actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Pick a draft segment_added cadence and wire it to this segment, then
// activate. This is the multi-email path that complements the single-shot
// /campaigns/new flow. Filters to draft cadences with segment_added trigger
// because those are the ones that can be wired without changing their type.

export default async function LaunchSequencePage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;

  const db = createAdminClient();
  const { data: segment } = await db
    .from("segments")
    .select("id, name, description, member_count")
    .eq("id", id)
    .maybeSingle();
  if (!segment) notFound();

  // Surface draft AND paused cadences so the operator can wire a fresh one
  // OR re-activate a paused sequence here. Active cadences are listed too
  // (read-only) so the operator sees what's already running on this segment.
  const { data: cadences } = await db
    .from("cadences")
    .select("id, name, description, status, sequence_json, trigger_config, max_new_enrollments_per_run")
    .eq("trigger_type", "segment_added")
    .order("status", { ascending: true })
    .order("name", { ascending: true });

  const cadenceList = ((cadences ?? []) as Array<{
    id: string;
    name: string;
    description: string | null;
    status: string;
    sequence_json: unknown;
    trigger_config: { segment_id?: string } | null;
    max_new_enrollments_per_run: number | null;
  }>);

  // Resolve segment names for any cadence pointing at a non-placeholder
  // segment, so each card can render "currently wired to: SegmentX".
  const otherSegmentIds = Array.from(
    new Set(
      cadenceList
        .map((c) => c.trigger_config?.segment_id)
        .filter(
          (sid): sid is string =>
            !!sid && sid !== "00000000-0000-0000-0000-000000000000",
        ),
    ),
  );
  const { data: otherSegments } =
    otherSegmentIds.length > 0
      ? await db
          .from("segments")
          .select("id, name")
          .in("id", otherSegmentIds)
      : { data: [] };
  const segmentNameById = new Map<string, string>(
    ((otherSegments ?? []) as Array<{ id: string; name: string }>).map((s) => [
      s.id,
      s.name,
    ]),
  );

  const drafts = cadenceList.map((c) => {
    const parsed = CadenceSequence.safeParse(c.sequence_json);
    const stepCount = parsed.success ? parsed.data.steps.length : 0;
    const totalDelay = parsed.success
      ? parsed.data.steps.reduce((sum, s) => sum + s.delay_hours, 0)
      : 0;
    const pointedAt = c.trigger_config?.segment_id ?? null;
    return {
      ...c,
      step_count: stepCount,
      duration_days: Math.round((totalDelay / 24) * 10) / 10,
      currently_pointed_at: pointedAt,
      currently_pointed_at_name:
        pointedAt && pointedAt !== "00000000-0000-0000-0000-000000000000"
          ? (segmentNameById.get(pointedAt) ?? "(unknown segment)")
          : null,
    };
  });

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <Link
        href={`/segments/${id}`}
        className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        Back to segment
      </Link>

      <div className="mb-6">
        <div className="flex items-center gap-2">
          <Rocket className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">
            Launch sequence
          </h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Wire a draft cadence to{" "}
          <span className="font-medium text-foreground">{segment.name}</span>
          {" "}({segment.member_count?.toLocaleString() ?? 0} users) and activate
          it. The orchestrator enrolls members on the next hourly tick (within
          ~1 hour) and the runner sends Day 0 within 15 minutes after that.
        </p>
      </div>

      {drafts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              No draft cadences with a segment trigger. Add one via SQL
              migration first (see existing cadences for the pattern), then
              come back here to wire it.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {drafts.map((c) => {
            const alreadyWiredHere = c.currently_pointed_at === id;
            const wiredElsewhere =
              c.currently_pointed_at &&
              c.currently_pointed_at !== id &&
              c.currently_pointed_at !==
                "00000000-0000-0000-0000-000000000000";
            return (
              <Card key={c.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between gap-2 text-base">
                    <Link
                      href={`/cadences/${c.id}`}
                      className="hover:underline"
                    >
                      {c.name}
                    </Link>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge
                        variant={
                          c.status === "active"
                            ? "default"
                            : c.status === "paused"
                              ? "outline"
                              : "secondary"
                        }
                        className="text-[10px]"
                      >
                        {c.status}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        {c.step_count} step{c.step_count === 1 ? "" : "s"}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        {c.duration_days}d
                      </Badge>
                      {c.max_new_enrollments_per_run && (
                        <Badge variant="secondary" className="text-[10px]">
                          {c.max_new_enrollments_per_run}/run
                        </Badge>
                      )}
                    </div>
                  </CardTitle>
                  {c.description && (
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {c.description}
                    </p>
                  )}
                  <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                    Currently wired to:{" "}
                    <span className="normal-case text-foreground">
                      {alreadyWiredHere
                        ? `${segment.name} (this one)`
                        : c.currently_pointed_at_name
                          ? c.currently_pointed_at_name
                          : "— not wired"}
                    </span>
                  </p>
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-3 pt-2">
                  {c.status === "active" && alreadyWiredHere ? (
                    <p className="text-xs text-muted-foreground">
                      Currently active and wired here. Pause it on{" "}
                      <Link
                        href={`/cadences/${c.id}`}
                        className="underline"
                      >
                        the cadence page
                      </Link>{" "}
                      first if you want to swap.
                    </p>
                  ) : c.status === "active" && wiredElsewhere ? (
                    <p className="text-xs text-muted-foreground">
                      Active on a different segment. Pause it first to rewire
                      here.
                    </p>
                  ) : wiredElsewhere ? (
                    <p className="text-xs text-muted-foreground">
                      Currently pointed at a different segment — wiring here
                      will rewire it.
                    </p>
                  ) : alreadyWiredHere ? (
                    <p className="text-xs text-muted-foreground">
                      Already pointed here. Wiring just flips status to active.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Will set this cadence&apos;s segment to{" "}
                      <span className="font-medium text-foreground">
                        {segment.name}
                      </span>{" "}
                      and activate it.
                    </p>
                  )}
                  {c.status === "active" ? (
                    <Link
                      href={`/cadences/${c.id}`}
                      className={cn(
                        buttonVariants({ size: "sm", variant: "outline" }),
                        "gap-1.5",
                      )}
                    >
                      View running
                    </Link>
                  ) : (
                    <form action={attachCadenceToSegmentAction}>
                      <input type="hidden" name="segment_id" value={id} />
                      <input type="hidden" name="cadence_id" value={c.id} />
                      <Button type="submit" size="sm" className="gap-1.5">
                        <Rocket className="h-3.5 w-3.5" />
                        Wire & activate
                      </Button>
                    </form>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
