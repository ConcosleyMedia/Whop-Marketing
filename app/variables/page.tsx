import { Braces, Plus, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  createVariableAction,
  deleteVariableAction,
  updateVariableAction,
} from "./actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type VariableRow = {
  id: string;
  key: string;
  value: string;
  description: string | null;
  updated_at: string | null;
};

export default async function VariablesPage(props: {
  searchParams: Promise<{ error?: string; edit?: string }>;
}) {
  const sp = await props.searchParams;
  const editId = sp.edit ?? null;

  const db = createAdminClient();
  const { data } = await db
    .from("template_variables")
    .select("id, key, value, description, updated_at")
    .order("key");

  const variables = (data ?? []) as VariableRow[];

  // Per-template usage counts — scan all templates for {{KEY}} references.
  const { data: templateRows } = await db
    .from("email_templates")
    .select("html")
    .limit(1000);
  const usage = new Map<string, number>();
  const re = /\{\{\s*([A-Z][A-Z0-9_]*)\s*\}\}/g;
  for (const row of (templateRows ?? []) as { html: string }[]) {
    let m: RegExpExecArray | null;
    const r = new RegExp(re);
    while ((m = r.exec(row.html)) !== null) {
      usage.set(m[1], (usage.get(m[1]) ?? 0) + 1);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Variables</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {variables.length} variable{variables.length === 1 ? "" : "s"} ·
            reference them in templates as{" "}
            <code className="rounded bg-muted px-1 font-mono text-[12px]">
              {"{{KEY_NAME}}"}
            </code>
          </p>
        </div>
      </div>

      {sp.error && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {sp.error}
        </div>
      )}

      {/* List */}
      {variables.length === 0 ? (
        <Card className="mb-6">
          <CardContent className="py-12 text-center">
            <Braces className="mx-auto mb-3 h-7 w-7 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No variables yet. Add one below.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="mb-6 overflow-hidden rounded-md border bg-background">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Key</th>
                <th className="px-4 py-2">Value</th>
                <th className="px-4 py-2 text-right">Usage</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {variables.map((v) => {
                const isEditing = editId === v.id;
                const boundUpdate = updateVariableAction.bind(null, v.id);
                const boundDelete = deleteVariableAction.bind(null, v.id);
                const useCount = usage.get(v.key) ?? 0;
                return (
                  <tr key={v.id} className="align-top">
                    <td className="px-4 py-3 align-middle">
                      <div className="font-mono text-[13px] font-semibold">
                        {`{{${v.key}}}`}
                      </div>
                      {v.description && (
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {v.description}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 align-middle">
                      {isEditing ? (
                        <form action={boundUpdate} className="grid gap-2">
                          <Input
                            name="value"
                            defaultValue={v.value}
                            required
                            className="h-8 font-mono text-xs"
                          />
                          <Input
                            name="description"
                            defaultValue={v.description ?? ""}
                            placeholder="Description (optional)"
                            className="h-8 text-xs"
                          />
                          <div className="flex items-center gap-2">
                            <Button
                              type="submit"
                              size="sm"
                              className="h-7 gap-1 text-xs"
                            >
                              <Save className="h-3 w-3" />
                              Save
                            </Button>
                            <Link
                              href="/variables"
                              className="text-xs text-muted-foreground hover:text-foreground"
                            >
                              Cancel
                            </Link>
                          </div>
                        </form>
                      ) : (
                        <div className="break-all font-mono text-xs text-foreground">
                          {v.value}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 align-middle text-right tabular-nums text-muted-foreground">
                      {useCount > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px]">
                          {useCount} ref{useCount === 1 ? "" : "s"}
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground/60">
                          unused
                        </span>
                      )}
                      <div className="mt-0.5 text-[10px] text-muted-foreground/70">
                        {formatRelative(v.updated_at)}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-middle text-right">
                      <div className="flex items-center justify-end gap-1">
                        {!isEditing && (
                          <Link
                            href={`/variables?edit=${v.id}`}
                            className={cn(
                              buttonVariants({
                                size: "sm",
                                variant: "ghost",
                              }),
                              "h-7 text-xs",
                            )}
                          >
                            Edit
                          </Link>
                        )}
                        <form action={boundDelete}>
                          <button
                            type="submit"
                            className={cn(
                              buttonVariants({
                                size: "sm",
                                variant: "ghost",
                              }),
                              "h-7 gap-1 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive",
                            )}
                            aria-label={`Delete ${v.key}`}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="h-4 w-4" />
            Add variable
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Keys are normalized to UPPER_SNAKE_CASE. Reference in templates as{" "}
            <code className="rounded bg-muted px-1 font-mono">
              {"{{YOUR_KEY}}"}
            </code>
            .
          </p>
        </CardHeader>
        <CardContent>
          <form
            action={createVariableAction}
            className="grid gap-3 sm:grid-cols-[220px_1fr_1fr_auto]"
          >
            <div className="grid gap-1.5">
              <Label htmlFor="key" className="text-xs">
                Key
              </Label>
              <Input
                id="key"
                name="key"
                required
                placeholder="WHOP_NEW_URL"
                className="h-9 font-mono text-sm"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="value" className="text-xs">
                Value
              </Label>
              <Input
                id="value"
                name="value"
                required
                placeholder="https://whop.com/..."
                className="h-9 font-mono text-sm"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="description" className="text-xs">
                Description (optional)
              </Label>
              <Input
                id="description"
                name="description"
                placeholder="What this link points to"
                className="h-9 text-sm"
              />
            </div>
            <div className="flex items-end">
              <Button type="submit" className="h-9 gap-1.5 whitespace-nowrap">
                <Plus className="h-3.5 w-3.5" />
                Add
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
