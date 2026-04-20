import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Filter, RefreshCw, Send, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { createAdminClient } from "@/lib/supabase/admin";
import { describeRule, FilterJsonSchema } from "@/lib/segments/schema";
import { formatMoney, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  evaluateSegmentAction,
  syncSegmentToMailerLiteAction,
} from "../actions";
import { DeleteSegmentButton } from "./delete-segment-button";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SegmentRow = {
  id: string;
  name: string;
  description: string | null;
  filter_json: unknown;
  member_count: number | null;
  last_evaluated_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type MemberRow = {
  user_id: string;
  added_at: string;
  users: {
    id: string;
    email: string | null;
    name: string | null;
    lifecycle_stage: string | null;
    total_ltv: number | string | null;
  } | null;
};

function lifecycleTone(
  stage: string | null,
): "default" | "secondary" | "destructive" | "outline" {
  if (stage === "active") return "default";
  if (stage === "churned") return "destructive";
  return "secondary";
}

export default async function SegmentDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; synced?: string }>;
}) {
  const { id } = await props.params;
  const sp = await props.searchParams;

  const db = createAdminClient();
  const { data: segmentData } = await db
    .from("segments")
    .select("id, name, description, filter_json, member_count, last_evaluated_at, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (!segmentData) notFound();
  const segment = segmentData as SegmentRow;

  const parsedFilter = FilterJsonSchema.safeParse(segment.filter_json);

  const { data: memberData } = await db
    .from("segment_members")
    .select(
      "user_id, added_at, users!inner(id, email, name, lifecycle_stage, total_ltv)",
    )
    .eq("segment_id", id)
    .order("added_at", { ascending: false })
    .limit(50);

  const members = (memberData ?? []) as unknown as MemberRow[];

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-4">
        <Link
          href="/segments"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All segments
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Filter className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {segment.name}
            </h1>
            {segment.description && (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {segment.description}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {segment.last_evaluated_at
                ? `Last evaluated ${formatRelative(segment.last_evaluated_at)}`
                : "Never evaluated"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form action={evaluateSegmentAction}>
            <input type="hidden" name="id" value={segment.id} />
            <Button type="submit" variant="outline" size="sm" className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
              Re-evaluate
            </Button>
          </form>
          <form action={syncSegmentToMailerLiteAction}>
            <input type="hidden" name="id" value={segment.id} />
            <Button type="submit" variant="outline" size="sm" className="gap-1.5">
              <Upload className="h-3.5 w-3.5" />
              Sync to MailerLite
            </Button>
          </form>
          <Link
            href={`/campaigns/new?segment=${segment.id}`}
            className={cn(
              buttonVariants({ size: "sm" }),
              "gap-1.5",
            )}
          >
            <Send className="h-3.5 w-3.5" />
            Send campaign
          </Link>
          <DeleteSegmentButton id={segment.id} />
        </div>
      </div>

      {sp.error && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {sp.error}
        </div>
      )}
      {sp.synced && (
        <div className="mb-4 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400">
          Synced to MailerLite · {sp.synced}
        </div>
      )}

      <section className="mb-6 grid gap-3 sm:grid-cols-3">
        <Kpi
          label="Members"
          value={(segment.member_count ?? 0).toLocaleString()}
        />
        <Kpi
          label="Rules"
          value={
            parsedFilter.success
              ? `${parsedFilter.data.rules.length} · match ${parsedFilter.data.match}`
              : "—"
          }
        />
        <Kpi
          label="Created"
          value={segment.created_at ? formatRelative(segment.created_at) : "—"}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Members ({(segment.member_count ?? 0).toLocaleString()})
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Showing up to the 50 most recently added. Re-evaluate to refresh.
            </p>
          </CardHeader>
          <CardContent>
            {members.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No members yet. Try re-evaluating.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b text-muted-foreground">
                  <tr>
                    <Th>User</Th>
                    <Th>Lifecycle</Th>
                    <Th>LTV</Th>
                    <Th>Added</Th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr
                      key={m.user_id}
                      className="border-b last:border-b-0 hover:bg-muted/30"
                    >
                      <td className="px-3 py-2">
                        {m.users ? (
                          <Link
                            href={`/users/${m.users.id}`}
                            className="font-medium hover:underline"
                          >
                            {m.users.name ?? m.users.email ?? "Unknown"}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">
                            (deleted user)
                          </span>
                        )}
                        {m.users?.email && m.users.name && (
                          <div className="truncate text-xs text-muted-foreground">
                            {m.users.email}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {m.users?.lifecycle_stage ? (
                          <Badge variant={lifecycleTone(m.users.lifecycle_stage)}>
                            {m.users.lifecycle_stage}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {formatMoney(m.users?.total_ltv ?? 0)}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {formatRelative(m.added_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Filter rules</CardTitle>
            {parsedFilter.success && (
              <p className="text-xs text-muted-foreground">
                Match {parsedFilter.data.match} of the following
              </p>
            )}
          </CardHeader>
          <CardContent>
            {parsedFilter.success ? (
              <ul className="space-y-1 text-sm">
                {parsedFilter.data.rules.map((r, i) => (
                  <li key={i} className="rounded-md border bg-muted/30 px-2 py-1">
                    {describeRule(r)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-destructive">
                Filter JSON is invalid — re-create this segment.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
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
    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide">
      {children}
    </th>
  );
}
