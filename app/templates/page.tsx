import Link from "next/link";
import { FileText, Plus, Search } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { createAdminClient } from "@/lib/supabase/admin";
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

// Parse "Campaign · Day NN ..." into campaign + day number.
// Falls back to "Other" / null when the name doesn't follow the convention.
function parseCampaign(name: string): {
  campaign: string;
  dayNum: number | null;
  dayLabel: string | null;
} {
  const m = name.match(/^(.+?)\s*·\s*Day\s*0*(\d+)(.*)$/i);
  if (m) {
    return {
      campaign: m[1].trim(),
      dayNum: parseInt(m[2], 10),
      dayLabel: `Day ${parseInt(m[2], 10)}`,
    };
  }
  return { campaign: "Other", dayNum: null, dayLabel: null };
}

// Order campaigns by a sensible operator priority: in-flight > recently authored.
// Pilot 0 + welcome backfill are top because they're the active focus; others
// follow alphabetically.
const CAMPAIGN_PRIORITY: Record<string, number> = {
  "Pilot 0 · Free silent": 1,
  "Build Room": 2,
  "Win-back": 3,
  "Cancel-save": 4,
  "Past-due rescue": 5,
};

function campaignOrder(name: string): [number, string] {
  return [CAMPAIGN_PRIORITY[name] ?? 99, name];
}

export default async function TemplatesPage(props: {
  searchParams: Promise<{ q?: string; campaign?: string }>;
}) {
  const sp = await props.searchParams;
  const q = (sp.q ?? "").trim();
  const campaignFilter = (sp.campaign ?? "").trim();

  const db = createAdminClient();

  let query = db
    .from("email_templates")
    .select("id, name, description, labels, suggested_subject, updated_at")
    .order("name", { ascending: true });

  if (q) {
    const pattern = `%${q}%`;
    query = query.or(
      `name.ilike.${pattern},description.ilike.${pattern},suggested_subject.ilike.${pattern}`,
    );
  }

  const { data } = await query;
  const allTemplates = (data ?? []) as TemplateRow[];

  // Group by campaign, sort each by day number.
  const groups = new Map<string, TemplateRow[]>();
  for (const t of allTemplates) {
    const { campaign } = parseCampaign(t.name);
    if (campaignFilter && campaign !== campaignFilter) continue;
    if (!groups.has(campaign)) groups.set(campaign, []);
    groups.get(campaign)!.push(t);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => {
      const da = parseCampaign(a.name).dayNum ?? 9999;
      const db_ = parseCampaign(b.name).dayNum ?? 9999;
      if (da !== db_) return da - db_;
      return a.name.localeCompare(b.name);
    });
  }

  const orderedCampaigns = [...groups.keys()].sort((a, b) => {
    const [pa, na] = campaignOrder(a);
    const [pb, nb] = campaignOrder(b);
    if (pa !== pb) return pa - pb;
    return na.localeCompare(nb);
  });

  // Campaign chip list = full set, regardless of current filter.
  const allCampaignNames = new Set<string>();
  for (const t of allTemplates) {
    allCampaignNames.add(parseCampaign(t.name).campaign);
  }
  const allCampaigns = [...allCampaignNames].sort((a, b) => {
    const [pa, na] = campaignOrder(a);
    const [pb, nb] = campaignOrder(b);
    if (pa !== pb) return pa - pb;
    return na.localeCompare(nb);
  });

  const totalShown = orderedCampaigns.reduce(
    (sum, c) => sum + (groups.get(c)?.length ?? 0),
    0,
  );

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-6 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Templates</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {totalShown} template{totalShown === 1 ? "" : "s"} across{" "}
            {orderedCampaigns.length} campaign
            {orderedCampaigns.length === 1 ? "" : "s"}
            {q || campaignFilter ? " · filtered" : ""}
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
        {campaignFilter && (
          <input type="hidden" name="campaign" value={campaignFilter} />
        )}
        <button
          type="submit"
          className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
        >
          Search
        </button>
        {(q || campaignFilter) && (
          <Link
            href="/templates"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </Link>
        )}
      </form>

      {allCampaigns.length > 1 && (
        <div className="mb-6 flex flex-wrap gap-1.5">
          <span className="self-center text-[11px] uppercase tracking-wide text-muted-foreground">
            Campaigns
          </span>
          {allCampaigns.map((c) => {
            const active = campaignFilter === c;
            const href = active
              ? `/templates${q ? `?q=${encodeURIComponent(q)}` : ""}`
              : `/templates?campaign=${encodeURIComponent(c)}${
                  q ? `&q=${encodeURIComponent(q)}` : ""
                }`;
            return (
              <Link
                key={c}
                href={href}
                className={cn(
                  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs transition",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-muted/30 text-muted-foreground hover:text-foreground",
                )}
              >
                {c}
              </Link>
            );
          })}
        </div>
      )}

      {totalShown === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {q || campaignFilter
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
        <div className="space-y-8">
          {orderedCampaigns.map((campaign) => {
            const list = groups.get(campaign) ?? [];
            return (
              <section key={campaign}>
                <div className="mb-2 flex items-baseline justify-between gap-2 border-b pb-2">
                  <h2 className="text-base font-semibold tracking-tight">
                    {campaign}
                  </h2>
                  <span className="text-xs text-muted-foreground">
                    {list.length} email{list.length === 1 ? "" : "s"}
                  </span>
                </div>
                <ul className="divide-y">
                  {list.map((t) => {
                    const { dayLabel } = parseCampaign(t.name);
                    // Drop the campaign + day prefix from the displayed name —
                    // it's redundant with the section header and day pill.
                    const trimmedName = t.name
                      .replace(
                        new RegExp(
                          `^${campaign.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*·\\s*Day\\s*\\d+\\s*·?\\s*`,
                          "i",
                        ),
                        "",
                      )
                      .replace(
                        new RegExp(
                          `^${campaign.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*·\\s*Day\\s*\\d+\\s*\\(?`,
                          "i",
                        ),
                        "",
                      )
                      .replace(/\)\s*$/, "")
                      .trim();
                    return (
                      <li key={t.id}>
                        <Link
                          href={`/templates/${t.id}`}
                          className="group flex items-start gap-3 py-3 transition hover:bg-muted/30"
                        >
                          <span className="mt-0.5 inline-flex h-6 min-w-[3.5rem] items-center justify-center rounded bg-muted px-2 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                            {dayLabel ?? "—"}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-x-2">
                              <span className="font-medium truncate">
                                {t.suggested_subject ||
                                  trimmedName ||
                                  t.name}
                              </span>
                              {trimmedName && t.suggested_subject && (
                                <span className="text-xs text-muted-foreground truncate">
                                  · {trimmedName}
                                </span>
                              )}
                            </div>
                            {t.description && (
                              <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
                                {t.description}
                              </p>
                            )}
                          </div>
                          {(t.labels ?? []).some((l) =>
                            l.startsWith("PLACEHOLDER"),
                          ) && (
                            <Badge variant="destructive" className="text-[10px]">
                              placeholder
                            </Badge>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
