import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText, Pencil, Send, Trash2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  deleteTemplateAction,
  sendTestEmailAction,
  updateTemplateAction,
} from "../actions";
import { TemplateEditor } from "../template-editor";
import { SendTestForm } from "../send-test-form";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type TemplateRow = {
  id: string;
  name: string;
  description: string | null;
  labels: string[] | null;
  html: string;
  suggested_subject: string | null;
  preview_text: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export default async function TemplateDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string; error?: string }>;
}) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const editing = sp.edit === "1";

  const db = createAdminClient();
  const { data, error } = await db
    .from("email_templates")
    .select(
      "id, name, description, labels, html, suggested_subject, preview_text, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`template fetch failed: ${error.message}`);
  if (!data) notFound();
  const t = data as TemplateRow;

  // How many campaigns have used this template?
  const { count: campaignUsage } = await db
    .from("campaigns")
    .select("id", { count: "exact", head: true })
    .eq("app_template_id", id);

  const boundUpdate = updateTemplateAction.bind(null, id);
  const boundDelete = deleteTemplateAction.bind(null, id);

  // Surface existing labels + available variables for the editor.
  let existingLabels: string[] = [];
  let variables: Record<string, string> = {};
  if (editing) {
    const [{ data: allRows }, { data: varRows }] = await Promise.all([
      db.from("email_templates").select("labels").limit(1000),
      db.from("template_variables").select("key, value"),
    ]);
    const labelSet = new Set<string>();
    for (const r of (allRows ?? []) as { labels: string[] | null }[]) {
      for (const l of r.labels ?? []) labelSet.add(l);
    }
    existingLabels = [...labelSet].sort();
    variables = Object.fromEntries(
      ((varRows ?? []) as Array<{ key: string; value: string }>).map((v) => [
        v.key,
        v.value,
      ]),
    );
  }

  return (
    <main
      className={cn(
        "mx-auto px-4 py-6",
        editing ? "max-w-[1400px]" : "max-w-5xl",
      )}
    >
      <div className="mb-4">
        <Link
          href="/templates"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All templates
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
            <FileText className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {t.name}
            </h1>
            {t.description && (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {t.description}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!editing && (
            <>
              <SendTestForm
                templateId={t.id}
                defaultRecipient="kevin@brnk.studio"
                action={sendTestEmailAction}
              />
              <Link
                href={`/campaigns/new?template=${t.id}`}
                className={cn(
                  buttonVariants({ size: "sm" }),
                  "gap-1.5",
                )}
              >
                <Send className="h-3.5 w-3.5" />
                Use in campaign
              </Link>
              <Link
                href={`/templates/${t.id}?edit=1`}
                className={cn(
                  buttonVariants({ size: "sm", variant: "outline" }),
                  "gap-1.5",
                )}
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Link>
              <form action={boundDelete}>
                <button
                  type="submit"
                  className={cn(
                    buttonVariants({ size: "sm", variant: "ghost" }),
                    "gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive",
                  )}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </form>
            </>
          )}
        </div>
      </div>

      {sp.error && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {sp.error}
        </div>
      )}

      {editing ? (
        <TemplateEditor
          action={boundUpdate}
          defaults={{
            name: t.name,
            description: t.description,
            labels: t.labels,
            suggested_subject: t.suggested_subject,
            preview_text: t.preview_text,
            html: t.html,
          }}
          submitLabel="Save changes"
          cancelHref={`/templates/${t.id}`}
          existingLabels={existingLabels}
          variables={variables}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,280px)]">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">Preview</CardTitle>
              <span className="text-xs text-muted-foreground">
                Sandboxed — same HTML MailerLite will send
              </span>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-md border bg-white">
                <iframe
                  title="Template preview"
                  srcDoc={t.html}
                  sandbox=""
                  className="h-[600px] w-full"
                />
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                  View HTML source
                </summary>
                <pre className="mt-2 max-h-96 overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-xs">
                  <code>{t.html}</code>
                </pre>
              </details>
            </CardContent>
          </Card>

          <aside className="space-y-4">
            {(t.labels ?? []).length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Labels
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-1">
                    {(t.labels ?? []).map((l) => (
                      <Link
                        key={l}
                        href={`/templates?label=${encodeURIComponent(l)}`}
                      >
                        <Badge variant="secondary" className="hover:bg-muted">
                          {l}
                        </Badge>
                      </Link>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {(t.suggested_subject || t.preview_text) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Defaults
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {t.suggested_subject && (
                    <div>
                      <p className="text-xs text-muted-foreground">Subject</p>
                      <p>{t.suggested_subject}</p>
                    </div>
                  )}
                  {t.preview_text && (
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Preview text
                      </p>
                      <p className="text-muted-foreground">{t.preview_text}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Usage
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm">
                  <span className="tabular-nums font-semibold">
                    {campaignUsage ?? 0}
                  </span>{" "}
                  campaign{campaignUsage === 1 ? "" : "s"} use this template.
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Updated {formatRelative(t.updated_at)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Created {formatRelative(t.created_at)}
                </p>
              </CardContent>
            </Card>
          </aside>
        </div>
      )}
    </main>
  );
}
