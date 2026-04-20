"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus, Trash2, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  FIELDS,
  FIELD_BY_KEY,
  OP_LABELS,
  type FieldDef,
  type Op,
  type Rule,
} from "@/lib/segments/schema";

type PreviewResponse = {
  memberCount: number;
  sample: Array<{ id: string; email: string; name: string | null }>;
  error?: string;
};

type EditableRule = {
  field: string;
  op: Op;
  value: string;
  values: string[];
};

function initialRule(): EditableRule {
  return { field: FIELDS[0].key, op: FIELDS[0].ops[0], value: "", values: [] };
}

function ruleToWire(r: EditableRule): Rule {
  const def = FIELD_BY_KEY[r.field];
  if (!def) return { field: r.field, op: r.op };
  if (r.op === "is_null" || r.op === "is_not_null") {
    return { field: r.field, op: r.op };
  }
  if (r.op === "in" || r.op === "not_in") {
    const values = def.kind === "number"
      ? r.values.map((v) => Number(v)).filter((v) => Number.isFinite(v))
      : r.values;
    return { field: r.field, op: r.op, values };
  }
  const value: string | number =
    def.kind === "number" ||
    r.op === "lt_days_ago" ||
    r.op === "gt_days_ago"
      ? Number(r.value)
      : r.value;
  return { field: r.field, op: r.op, value };
}

export function SegmentBuilder({
  defaults,
}: {
  defaults?: { name?: string; description?: string; rules?: Rule[]; match?: "all" | "any" };
}) {
  const [match, setMatch] = useState<"all" | "any">(defaults?.match ?? "all");
  const [rules, setRules] = useState<EditableRule[]>(() => {
    if (defaults?.rules && defaults.rules.length > 0) {
      return defaults.rules.map((r) => ({
        field: r.field,
        op: r.op as Op,
        value:
          r.value === undefined || r.value === null ? "" : String(r.value),
        values: (r.values ?? []).map(String),
      }));
    }
    return [initialRule()];
  });

  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [pending, startTransition] = useTransition();

  const filterJson = useMemo(
    () => ({ match, rules: rules.map(ruleToWire) }),
    [match, rules],
  );
  const filterJsonString = JSON.stringify(filterJson);

  function updateRule(i: number, patch: Partial<EditableRule>) {
    setRules((prev) => {
      const next = [...prev];
      const merged = { ...next[i], ...patch };
      // If field changed, reset op to first supported op for the new field
      if (patch.field && patch.field !== next[i].field) {
        const def = FIELD_BY_KEY[patch.field];
        if (def) merged.op = def.ops[0];
        merged.value = "";
        merged.values = [];
      }
      next[i] = merged;
      return next;
    });
  }

  function runPreview() {
    setPreview(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/segments/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: filterJsonString,
        });
        const j = (await res.json()) as PreviewResponse;
        setPreview(j);
      } catch (e) {
        setPreview({
          memberCount: 0,
          sample: [],
          error: e instanceof Error ? e.message : String(e),
        });
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          name="name"
          required
          defaultValue={defaults?.name}
          placeholder="e.g. Active Pro subscribers with low engagement"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="description">Description (optional)</Label>
        <Input
          id="description"
          name="description"
          defaultValue={defaults?.description}
          placeholder="What this segment is for"
        />
      </div>

      <fieldset className="grid gap-3 rounded-md border p-4">
        <legend className="px-1 text-xs font-medium uppercase text-muted-foreground">
          Filter rules
        </legend>

        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">Match</span>
          <select
            value={match}
            onChange={(e) => setMatch(e.target.value as "all" | "any")}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="all">all of the following</option>
            <option value="any">any of the following</option>
          </select>
        </div>

        <div className="space-y-2">
          {rules.map((r, i) => (
            <RuleRow
              key={i}
              rule={r}
              onChange={(patch) => updateRule(i, patch)}
              onRemove={
                rules.length > 1
                  ? () =>
                      setRules((prev) => prev.filter((_, idx) => idx !== i))
                  : undefined
              }
            />
          ))}
        </div>

        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setRules((prev) => [...prev, initialRule()])
            }
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            Add rule
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={runPreview}
            disabled={pending}
            className="gap-1.5"
          >
            <Eye className="h-3.5 w-3.5" />
            {pending ? "Counting…" : "Preview matches"}
          </Button>
        </div>
      </fieldset>

      {preview && (
        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          {preview.error ? (
            <p className="text-destructive">{preview.error}</p>
          ) : (
            <>
              <p className="font-medium">
                {preview.memberCount.toLocaleString()} user
                {preview.memberCount === 1 ? "" : "s"} match
              </p>
              {preview.sample.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  {preview.sample.slice(0, 10).map((u) => (
                    <li key={u.id} className="truncate">
                      {u.name ? `${u.name} · ` : ""}
                      {u.email}
                    </li>
                  ))}
                  {preview.sample.length > 10 && (
                    <li className="text-muted-foreground/70">…and more</li>
                  )}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      <input type="hidden" name="filter_json" value={filterJsonString} />
    </div>
  );
}

function RuleRow({
  rule,
  onChange,
  onRemove,
}: {
  rule: EditableRule;
  onChange: (patch: Partial<EditableRule>) => void;
  onRemove?: () => void;
}) {
  const def = FIELD_BY_KEY[rule.field] as FieldDef | undefined;
  const needsValue = rule.op !== "is_null" && rule.op !== "is_not_null";
  const isMultiValue = rule.op === "in" || rule.op === "not_in";
  const isDaysAgo = rule.op === "lt_days_ago" || rule.op === "gt_days_ago";

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-background p-2">
      <select
        value={rule.field}
        onChange={(e) => onChange({ field: e.target.value })}
        className="h-8 min-w-[10rem] rounded-md border border-input bg-background px-2 text-sm"
      >
        {FIELDS.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label}
          </option>
        ))}
      </select>

      <select
        value={rule.op}
        onChange={(e) => onChange({ op: e.target.value as Op })}
        className="h-8 rounded-md border border-input bg-background px-2 text-sm"
      >
        {(def?.ops ?? []).map((op) => (
          <option key={op} value={op}>
            {OP_LABELS[op]}
          </option>
        ))}
      </select>

      {needsValue && (
        <>
          {isMultiValue ? (
            <Input
              value={rule.values.join(",")}
              onChange={(e) =>
                onChange({
                  values: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              placeholder="comma,separated,values"
              className="h-8 min-w-[12rem] flex-1"
            />
          ) : def?.kind === "enum" ? (
            <select
              value={rule.value}
              onChange={(e) => onChange({ value: e.target.value })}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="" disabled>
                Select…
              </option>
              {def.enumValues?.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          ) : (
            <Input
              value={rule.value}
              onChange={(e) => onChange({ value: e.target.value })}
              placeholder={
                isDaysAgo
                  ? "N days"
                  : def?.kind === "number"
                  ? "number"
                  : "value"
              }
              type={def?.kind === "number" || isDaysAgo ? "number" : "text"}
              className="h-8 min-w-[8rem] flex-1"
            />
          )}
          {isDaysAgo && (
            <span className="text-xs text-muted-foreground">days</span>
          )}
        </>
      )}

      {def?.helpText && (
        <span className="hidden text-xs text-muted-foreground md:inline">
          {def.helpText}
        </span>
      )}

      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          aria-label="Remove rule"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
