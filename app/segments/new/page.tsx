import Link from "next/link";
import { ArrowLeft, FilePlus2, Save, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SegmentBuilder } from "./segment-builder";
import { createSegmentAction } from "../actions";
import { createAdminClient } from "@/lib/supabase/admin";
import { describeRule, FilterJsonSchema, type Rule } from "@/lib/segments/schema";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type TemplateRow = {
  id: string;
  name: string;
  description: string | null;
  filter_json: unknown;
};

export default async function NewSegmentPage(props: {
  searchParams: Promise<{ error?: string; template?: string }>;
}) {
  const sp = await props.searchParams;
  const db = createAdminClient();

  const { data } = await db
    .from("segments")
    .select("id, name, description, filter_json")
    .eq("is_starter_template", true)
    .order("name");

  const templates = (data ?? []) as TemplateRow[];
  const selected = sp.template
    ? templates.find((t) => t.id === sp.template)
    : undefined;

  let defaults:
    | { name?: string; description?: string; rules?: Rule[]; match?: "all" | "any" }
    | undefined;

  if (selected) {
    const parsed = FilterJsonSchema.safeParse(selected.filter_json);
    defaults = {
      name: selected.name,
      description: selected.description ?? undefined,
      match: parsed.success ? parsed.data.match : "all",
      rules: parsed.success ? parsed.data.rules : [],
    };
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4">
        <Link
          href="/segments"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All segments
        </Link>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">New segment</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {selected
            ? `Pre-filled from the "${selected.name}" template — edit anything before saving.`
            : "Define filter rules, preview matches, then save. Membership is materialized on save and can be re-evaluated anytime."}
        </p>
      </div>

      {sp.error && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {sp.error}
        </div>
      )}

      {!selected && templates.length > 0 && (
        <section className="mb-6">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Start from a template
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {templates.map((t) => {
              const parsed = FilterJsonSchema.safeParse(t.filter_json);
              const summary = parsed.success
                ? parsed.data.rules.slice(0, 2).map(describeRule)
                : [];
              const extra =
                parsed.success && parsed.data.rules.length > 2
                  ? ` +${parsed.data.rules.length - 2} more`
                  : "";
              return (
                <Link
                  key={t.id}
                  href={`/segments/new?template=${t.id}`}
                  className="block"
                >
                  <Card className="h-full transition hover:border-foreground/30">
                    <CardContent className="space-y-2 p-4">
                      <p className="text-sm font-medium">{t.name}</p>
                      {t.description && (
                        <p className="text-xs text-muted-foreground">
                          {t.description}
                        </p>
                      )}
                      {summary.length > 0 && (
                        <ul className="space-y-0.5 text-xs text-muted-foreground/80">
                          {summary.map((r, i) => (
                            <li key={i} className="truncate">
                              · {r}
                            </li>
                          ))}
                          {extra && (
                            <li className="text-muted-foreground/60">
                              {extra}
                            </li>
                          )}
                        </ul>
                      )}
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            Or{" "}
            <span className="font-medium text-foreground">
              start blank below
            </span>{" "}
            — no template needed.
          </div>
        </section>
      )}

      {selected && (
        <div className="mb-4 flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-xs">
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <Sparkles className="h-3 w-3" />
            Using template:{" "}
            <span className="font-medium text-foreground">{selected.name}</span>
          </span>
          <Link
            href="/segments/new"
            className={cn(
              "inline-flex items-center gap-1 text-muted-foreground hover:text-foreground",
            )}
          >
            <FilePlus2 className="h-3 w-3" />
            Start blank instead
          </Link>
        </div>
      )}

      <form action={createSegmentAction} className="space-y-5">
        <SegmentBuilder
          key={selected?.id ?? "blank"}
          defaults={defaults}
        />

        <div className="flex items-center justify-between border-t pt-4">
          <Link
            href="/segments"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Link>
          <Button type="submit" className="gap-1.5">
            <Save className="h-3.5 w-3.5" />
            Save segment
          </Button>
        </div>
      </form>
    </main>
  );
}
