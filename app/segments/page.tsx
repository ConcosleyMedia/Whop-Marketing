import Link from "next/link";
import { ArrowRight, Filter, Plus } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { createAdminClient } from "@/lib/supabase/admin";
import { describeRule, FilterJsonSchema } from "@/lib/segments/schema";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

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
};

export default async function SegmentsPage() {
  const db = createAdminClient();
  const { data } = await db
    .from("segments")
    .select("id, name, description, filter_json, member_count, last_evaluated_at, created_at")
    .order("created_at", { ascending: false });

  const segments = (data ?? []) as SegmentRow[];

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-6 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Segments</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {segments.length} segment{segments.length === 1 ? "" : "s"} ·
            filters against Whop + email engagement data
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/segments/mailerlite"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            MailerLite-native →
          </Link>
          <Link
            href="/segments/new"
            className={cn(buttonVariants({ size: "sm" }), "gap-1.5")}
          >
            <Plus className="h-3.5 w-3.5" />
            New segment
          </Link>
        </div>
      </div>

      {segments.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Filter className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No segments yet.
            </p>
            <Link
              href="/segments/new"
              className={cn(buttonVariants({ size: "sm" }), "mt-4 gap-1.5")}
            >
              <Plus className="h-3.5 w-3.5" />
              Create your first segment
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {segments.map((s) => {
            const parsed = FilterJsonSchema.safeParse(s.filter_json);
            const ruleSummary = parsed.success
              ? parsed.data.rules.slice(0, 3).map(describeRule)
              : ["(invalid filter)"];
            const extra =
              parsed.success && parsed.data.rules.length > 3
                ? ` +${parsed.data.rules.length - 3} more`
                : "";
            return (
              <Card key={s.id} className="transition hover:border-foreground/20">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between gap-2 text-base">
                    <Link
                      href={`/segments/${s.id}`}
                      className="inline-flex items-center gap-1.5 hover:underline"
                    >
                      <Filter className="h-4 w-4 text-muted-foreground" />
                      {s.name}
                    </Link>
                    <span className="text-sm font-normal text-muted-foreground tabular-nums">
                      {(s.member_count ?? 0).toLocaleString()}
                    </span>
                  </CardTitle>
                  {s.description && (
                    <p className="text-xs text-muted-foreground">{s.description}</p>
                  )}
                </CardHeader>
                <CardContent className="space-y-3">
                  <ul className="space-y-0.5 text-xs text-muted-foreground">
                    {ruleSummary.map((r, i) => (
                      <li key={i} className="truncate">
                        · {r}
                      </li>
                    ))}
                    {extra && <li className="text-muted-foreground/70">{extra}</li>}
                  </ul>
                  <div className="flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
                    <span>
                      {s.last_evaluated_at
                        ? `evaluated ${formatRelative(s.last_evaluated_at)}`
                        : "never evaluated"}
                    </span>
                    <Link
                      href={`/segments/${s.id}`}
                      className="inline-flex items-center gap-0.5 hover:text-foreground"
                    >
                      View
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
