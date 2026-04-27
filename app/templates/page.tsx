import Link from "next/link";
import { FileText, Plus, Search, Tag } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type TemplateRow = {
  id: string;
  name: string;
  description: string | null;
  labels: string[] | null;
  suggested_subject: string | null;
  updated_at: string | null;
};

export default async function TemplatesPage(props: {
  searchParams: Promise<{ q?: string; label?: string }>;
}) {
  const sp = await props.searchParams;
  const q = (sp.q ?? "").trim();
  const label = (sp.label ?? "").trim().toLowerCase();

  const db = createAdminClient();

  let query = db
    .from("email_templates")
    .select("id, name, description, labels, suggested_subject, updated_at")
    .order("updated_at", { ascending: false });

  if (q) {
    const pattern = `%${q}%`;
    query = query.or(
      `name.ilike.${pattern},description.ilike.${pattern},suggested_subject.ilike.${pattern}`,
    );
  }
  if (label) {
    query = query.contains("labels", [label]);
  }

  const { data } = await query;
  const templates = (data ?? []) as TemplateRow[];

  // Gather all distinct labels across the library for the filter chip row.
  // Safe to run a second query — this list is small (< a few hundred rows).
  const { data: allRows } = await db
    .from("email_templates")
    .select("labels")
    .limit(1000);
  const labelCounts = new Map<string, number>();
  for (const r of (allRows ?? []) as { labels: string[] | null }[]) {
    for (const l of r.labels ?? []) {
      labelCounts.set(l, (labelCounts.get(l) ?? 0) + 1);
    }
  }
  const allLabels = [...labelCounts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-6 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Templates</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {templates.length} template{templates.length === 1 ? "" : "s"}
            {q || label ? " matched · filtered" : " · reusable email HTML"}
          </p>
        </div>
        <Link
          href="/templates/new"
          className={cn(buttonVariants({ size: "sm" }), "gap-1.5")}
        >
          <Plus className="h-3.5 w-3.5" />
          New template
        </Link>
      </div>

      <form className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[14rem]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={q}
            placeholder="Search name, description, subject…"
            className="h-9 pl-8"
          />
        </div>
        {label && <input type="hidden" name="label" value={label} />}
        <button
          type="submit"
          className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
        >
          Search
        </button>
        {(q || label) && (
          <Link
            href="/templates"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </Link>
        )}
      </form>

      {allLabels.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-1.5">
          <Tag className="mr-0.5 h-3 w-3 text-muted-foreground" />
          {allLabels.map(([name, count]) => {
            const active = label === name;
            const href = active
              ? `/templates${q ? `?q=${encodeURIComponent(q)}` : ""}`
              : `/templates?label=${encodeURIComponent(name)}${
                  q ? `&q=${encodeURIComponent(q)}` : ""
                }`;
            return (
              <Link
                key={name}
                href={href}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-muted/30 text-muted-foreground hover:text-foreground",
                )}
              >
                {name}
                <span className="tabular-nums opacity-70">{count}</span>
              </Link>
            );
          })}
        </div>
      )}

      {templates.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {q || label
                ? "No templates match the filter."
                : "No templates yet."}
            </p>
            <Link
              href="/templates/new"
              className={cn(buttonVariants({ size: "sm" }), "mt-4 gap-1.5")}
            >
              <Plus className="h-3.5 w-3.5" />
              Upload your first template
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((t) => (
            <Link key={t.id} href={`/templates/${t.id}`} className="block">
              <Card className="h-full transition hover:border-foreground/30">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-start gap-2 text-base">
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  </CardTitle>
                  {t.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {t.description}
                    </p>
                  )}
                </CardHeader>
                <CardContent className="space-y-3">
                  {t.suggested_subject && (
                    <p className="truncate text-xs text-muted-foreground">
                      <span className="font-medium text-foreground/70">
                        Subject:
                      </span>{" "}
                      {t.suggested_subject}
                    </p>
                  )}
                  {(t.labels ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {(t.labels ?? []).slice(0, 5).map((l) => (
                        <Badge
                          key={l}
                          variant="secondary"
                          className="text-[10px] font-normal"
                        >
                          {l}
                        </Badge>
                      ))}
                      {(t.labels ?? []).length > 5 && (
                        <span className="text-[10px] text-muted-foreground">
                          +{(t.labels ?? []).length - 5}
                        </span>
                      )}
                    </div>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    Updated {formatRelative(t.updated_at)}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
