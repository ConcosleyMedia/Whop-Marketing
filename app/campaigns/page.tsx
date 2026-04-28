import Link from "next/link";
import { Mail, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { listCampaigns } from "@/lib/mailerlite/client";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { deleteCampaignAction } from "./actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const STATUS_TABS = [
  { key: "sent", label: "Sent" },
  { key: "ready", label: "Scheduled" },
  { key: "draft", label: "Drafts" },
] as const;
type StatusKey = (typeof STATUS_TABS)[number]["key"];

function statusTone(
  derived: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (derived === "sent") return "default";
  if (derived === "sending") return "secondary";
  if (derived === "scheduled") return "secondary";
  if (derived === "canceled") return "destructive";
  return "outline";
}

// MailerLite flips a campaign to status="sent" the moment it accepts the
// schedule — before recipients are actually processed. `finished_at` is
// only set after delivery completes. So "sent + null finished_at" is really
// "sending" — surface that honestly. Also relabel "ready" as "scheduled".
function deriveStatus(c: {
  status?: string | null;
  finished_at?: string | null;
}): string {
  const s = c.status ?? "unknown";
  if (s === "sent" && !c.finished_at) return "sending";
  if (s === "ready") return "scheduled";
  return s;
}

// MailerLite only allows deleting campaigns that haven't been fully sent.
// In practice: draft, ready (scheduled), canceled — and occasionally the
// in-flight "sending" state lets us cancel, but we'll leave that to the user.
function canDelete(derived: string): boolean {
  return derived === "draft" || derived === "scheduled" || derived === "canceled";
}

export default async function CampaignsPage(props: {
  searchParams: Promise<{ status?: string; page?: string; error?: string }>;
}) {
  const sp = await props.searchParams;
  const status: StatusKey = STATUS_TABS.map((t) => t.key).includes(
    sp.status as StatusKey,
  )
    ? (sp.status as StatusKey)
    : "sent";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  // MailerLite has been flaky / env-var fragile; don't take down the whole
  // route if its API call fails. Surface a banner instead so the operator
  // can fix the env var without staring at a 500.
  let campaigns: Awaited<ReturnType<typeof listCampaigns>>["campaigns"] = [];
  let total: number | null = 0;
  let mailerliteError: string | null = null;
  try {
    const r = await listCampaigns({ status, limit: 25, page });
    campaigns = r.campaigns;
    total = r.total;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    mailerliteError = msg;
    console.error(
      `[campaigns] listCampaigns failed: ${msg}`,
      err instanceof Error && "body" in err
        ? `body: ${(err as { body?: unknown }).body}`
        : "",
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total != null
              ? `${total.toLocaleString()} ${status} campaign${total === 1 ? "" : "s"}`
              : `${campaigns.length} ${status} campaign${campaigns.length === 1 ? "" : "s"} on this page`}{" "}
            · live from MailerLite
          </p>
        </div>
        <Link
          href="/campaigns/new"
          className={buttonVariants({ size: "sm" }) + " gap-1.5"}
        >
          <Plus className="h-3.5 w-3.5" />
          New campaign
        </Link>
      </div>

      {sp.error && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {sp.error}
        </div>
      )}

      {mailerliteError && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <p className="font-medium text-destructive">
            Couldn&rsquo;t reach MailerLite
          </p>
          <p className="mt-1 break-all font-mono text-[11px] text-destructive/80">
            {mailerliteError}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Check the <code>MAILERLITE_API_KEY</code> env var on Vercel — full
            JWT, no surrounding whitespace, no other vars in the same value.
            Then redeploy.
          </p>
        </div>
      )}

      <div className="mb-4 inline-flex rounded-md border p-0.5 text-sm">
        {STATUS_TABS.map((t) => (
          <Link
            key={t.key}
            href={
              t.key === "sent" ? "/campaigns" : `/campaigns?status=${t.key}`
            }
            className={cn(
              "rounded px-3 py-1 text-muted-foreground hover:text-foreground",
              status === t.key && "bg-muted text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {campaigns.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No {status} campaigns.
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-muted-foreground">
              <tr>
                <Th>Name</Th>
                <Th>Status</Th>
                <Th>Sent</Th>
                <Th>Open rate</Th>
                <Th>Click rate</Th>
                <Th>Unsubs</Th>
                <Th>Date</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => {
                const derived = deriveStatus(c);
                const dateLabel =
                  c.finished_at ??
                  c.scheduled_for ??
                  c.queued_at ??
                  c.updated_at ??
                  c.created_at ??
                  null;
                const deletable = canDelete(derived);
                const boundDelete = deleteCampaignAction.bind(null, c.id);
                return (
                  <tr
                    key={c.id}
                    className="border-b last:border-b-0 hover:bg-muted/30"
                  >
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/campaigns/${c.id}`}
                        className="inline-flex items-center gap-1.5 font-medium hover:underline"
                      >
                        <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                        {c.name}
                      </Link>
                      {c.emails?.[0]?.subject && (
                        <p className="truncate text-xs text-muted-foreground">
                          {c.emails[0].subject}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant={statusTone(derived)}>{derived}</Badge>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {(c.stats?.sent ?? 0).toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {c.stats?.open_rate?.string ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {c.stats?.click_rate?.string ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {(c.stats?.unsubscribes_count ?? 0).toLocaleString()}
                    </td>
                    <td
                      className="px-3 py-2.5 text-muted-foreground"
                      title={dateLabel ? formatDateTime(dateLabel) : ""}
                    >
                      {formatRelative(dateLabel)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {deletable && (
                        <form action={boundDelete}>
                          <button
                            type="submit"
                            className={cn(
                              buttonVariants({ size: "sm", variant: "ghost" }),
                              "h-7 gap-1 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive",
                            )}
                            title="Delete campaign (syncs to MailerLite)"
                            aria-label={`Delete ${c.name}`}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex items-center justify-end gap-2">
        {page > 1 && (
          <Link
            href={`/campaigns?status=${status}&page=${page - 1}`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Previous
          </Link>
        )}
        {campaigns.length === 25 && (
          <Link
            href={`/campaigns?status=${status}&page=${page + 1}`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Next
          </Link>
        )}
      </div>
    </main>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left font-medium text-xs uppercase tracking-wide">
      {children}
    </th>
  );
}
