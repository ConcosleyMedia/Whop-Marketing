import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTemplateAction } from "../actions";
import { TemplateEditor } from "../template-editor";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function NewTemplatePage(props: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await props.searchParams;

  // Surface existing labels so the user sees what's already in use.
  const db = createAdminClient();
  const [{ data: allRows }, { data: varRows }] = await Promise.all([
    db.from("email_templates").select("labels").limit(1000),
    db.from("template_variables").select("key, value"),
  ]);
  const labelSet = new Set<string>();
  for (const r of (allRows ?? []) as { labels: string[] | null }[]) {
    for (const l of r.labels ?? []) labelSet.add(l);
  }
  const existingLabels = [...labelSet].sort();
  const variables = Object.fromEntries(
    ((varRows ?? []) as Array<{ key: string; value: string }>).map((v) => [
      v.key,
      v.value,
    ]),
  );

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-6">
      <div className="mb-4">
        <Link
          href="/templates"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All templates
        </Link>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">New template</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Paste the HTML body, give it a name, and tag it with labels for easy
          reuse. Live preview on the right updates as you type.
        </p>
      </div>

      {sp.error && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {sp.error}
        </div>
      )}

      <TemplateEditor
        action={createTemplateAction}
        submitLabel="Save template"
        cancelHref="/templates"
        existingLabels={existingLabels}
        variables={variables}
      />
    </main>
  );
}
