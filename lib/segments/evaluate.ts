import { createAdminClient } from "@/lib/supabase/admin";
import {
  FIELD_BY_KEY,
  FilterJsonSchema,
  type FilterJson,
  type Op,
  type Rule,
} from "./schema";

// Translate a validated FilterJson into a PostgREST query against
// segment_eligibility_view. Field names and operators are whitelisted by
// FilterJsonSchema, so values are the only user-controlled input and pass
// through the parameterized Supabase client.
//
// The Supabase PostgREST builder's filter chain returns a different generic
// type at each stage (QueryBuilder → FilterBuilder), and preserving narrow
// types through a helper isn't worth the ceremony. We use `Builder = any` for
// intermediate values and only type the public return shapes.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Builder = any;

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function applyRule(q: Builder, rule: Rule): Builder {
  const { field } = rule;
  const op = rule.op as Op;
  const val = rule.value;
  const vals = rule.values ?? [];

  switch (op) {
    case "eq":  return q.eq(field, val);
    case "neq": return q.neq(field, val);
    case "gt":  return q.gt(field, val);
    case "gte": return q.gte(field, val);
    case "lt":  return q.lt(field, val);
    case "lte": return q.lte(field, val);
    case "in":  return q.in(field, vals);
    case "not_in":
      return q.not(
        field,
        "in",
        `(${vals.map((v) => JSON.stringify(String(v))).join(",")})`,
      );
    case "is_null":     return q.is(field, null);
    case "is_not_null": return q.not(field, "is", null);
    case "contains":     return q.ilike(field, `%${String(val)}%`);
    case "not_contains": return q.not(field, "ilike", `%${String(val)}%`);
    case "lt_days_ago":  return q.gte(field, daysAgoIso(Number(val)));
    case "gt_days_ago":  return q.lt (field, daysAgoIso(Number(val)));
    case "tag_includes":     return q.contains(field, [String(val)]);
    case "tag_not_includes": return q.not(field, "cs", `{${String(val)}}`);
    default: return q;
  }
}

// PostgREST .or() takes a comma-separated expression. Only simple ops
// translate cleanly to the string form — the rest return null and are
// skipped. For v1, "any" match supports the common operators.
function ruleToOrClause(rule: Rule): string | null {
  const op = rule.op as Op;
  const val = rule.value;
  const vals = rule.values ?? [];
  const f = rule.field;
  const esc = (v: unknown) =>
    String(v).includes(",") ? `"${String(v).replace(/"/g, '\\"')}"` : String(v);
  switch (op) {
    case "eq":  return `${f}.eq.${esc(val)}`;
    case "neq": return `${f}.neq.${esc(val)}`;
    case "gt":  return `${f}.gt.${esc(val)}`;
    case "gte": return `${f}.gte.${esc(val)}`;
    case "lt":  return `${f}.lt.${esc(val)}`;
    case "lte": return `${f}.lte.${esc(val)}`;
    case "in":  return `${f}.in.(${vals.map(esc).join(",")})`;
    case "is_null":     return `${f}.is.null`;
    case "is_not_null": return `${f}.not.is.null`;
    case "contains":    return `${f}.ilike.*${esc(val)}*`;
    case "lt_days_ago": return `${f}.gte.${daysAgoIso(Number(val))}`;
    case "gt_days_ago": return `${f}.lt.${daysAgoIso(Number(val))}`;
    default: return null;
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildFilteredQuery(filter: FilterJson, base: Builder): Builder {
  if (filter.match === "any") {
    const clause = filter.rules
      .map(ruleToOrClause)
      .filter(Boolean)
      .join(",");
    return clause ? base.or(clause) : base;
  }
  return filter.rules.reduce(applyRule, base);
}

export type EvaluateResult = {
  memberCount: number;
  sample: Array<{ id: string; email: string; name: string | null }>;
};

export async function previewSegment(
  filter: FilterJson,
  sampleSize = 20,
): Promise<EvaluateResult> {
  FilterJsonSchema.parse(filter);
  const db = createAdminClient();

  const base = db
    .from("segment_eligibility_view")
    .select("id, email, name", { count: "exact" });

  const q = buildFilteredQuery(filter, base).limit(sampleSize);
  const { data, error, count } = await q;
  if (error) throw error;
  return {
    memberCount: count ?? 0,
    sample: (data ?? []) as EvaluateResult["sample"],
  };
}

export async function evaluateSegment(
  segmentId: string,
  filter: FilterJson,
): Promise<number> {
  FilterJsonSchema.parse(filter);
  const db = createAdminClient();

  const ids = await collectMatchingIds(filter);

  const del = await db
    .from("segment_members")
    .delete()
    .eq("segment_id", segmentId);
  if (del.error) throw del.error;

  for (const c of chunk(ids, 1000)) {
    const rows = c.map((user_id) => ({ segment_id: segmentId, user_id }));
    const ins = await db.from("segment_members").insert(rows);
    if (ins.error) throw ins.error;
  }

  const upd = await db
    .from("segments")
    .update({
      member_count: ids.length,
      last_evaluated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", segmentId);
  if (upd.error) throw upd.error;

  return ids.length;
}

async function collectMatchingIds(filter: FilterJson): Promise<string[]> {
  const db = createAdminClient();
  const pageSize = 1000;
  const all: string[] = [];
  let offset = 0;
  while (true) {
    const base = db.from("segment_eligibility_view").select("id");
    const q = buildFilteredQuery(filter, base).range(offset, offset + pageSize - 1);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as Array<{ id: string }>;
    all.push(...rows.map((r) => r.id));
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

export function getFieldDef(key: string) {
  return FIELD_BY_KEY[key];
}
