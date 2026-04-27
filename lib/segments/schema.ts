import { z } from "zod";

// The single source of truth for what can be filtered on.
// Every column in segment_eligibility_view that's intended to be filterable
// must appear here. Fields not listed here are rejected by the validator,
// which is how we avoid SQL injection while accepting a JSON rule DSL.

export type FieldKind =
  | "enum"
  | "number"
  | "text"
  | "timestamp"
  | "tags";

export type Op =
  | "eq"
  | "neq"
  | "in"
  | "not_in"
  | "gte"
  | "lte"
  | "gt"
  | "lt"
  | "contains"
  | "not_contains"
  | "is_null"
  | "is_not_null"
  | "lt_days_ago"
  | "gt_days_ago"
  | "tag_includes"
  | "tag_not_includes";

export type FieldDef = {
  key: string;
  label: string;
  kind: FieldKind;
  ops: Op[];
  enumValues?: readonly string[];
  helpText?: string;
};

const OPS_ENUM  : Op[] = ["eq", "neq", "in", "not_in"];
const OPS_NUM   : Op[] = ["gte", "lte", "gt", "lt", "eq", "neq"];
const OPS_TEXT  : Op[] = ["contains", "not_contains", "eq", "neq"];
const OPS_TIME  : Op[] = ["lt_days_ago", "gt_days_ago", "is_null", "is_not_null"];
const OPS_TAG   : Op[] = ["tag_includes", "tag_not_includes"];

export const FIELDS: readonly FieldDef[] = [
  {
    key: "email",
    label: "Email address",
    kind: "text",
    ops: OPS_TEXT,
    helpText: "Match by email — supports contains / equals",
  },
  {
    key: "lifecycle_stage",
    label: "Lifecycle stage",
    kind: "enum",
    enumValues: ["active", "churned", "prospect"],
    ops: OPS_ENUM,
  },
  {
    key: "verification_status",
    label: "Email verification",
    kind: "enum",
    enumValues: ["valid", "risky", "invalid", "disposable", "accept_all", "unknown"],
    ops: OPS_ENUM,
    helpText: "MailerCheck result",
  },
  {
    key: "lead_temperature",
    label: "Lead temperature",
    kind: "enum",
    enumValues: ["hot", "warm", "cold"],
    ops: OPS_ENUM,
  },
  {
    key: "lead_score",
    label: "Lead score",
    kind: "number",
    ops: OPS_NUM,
  },
  {
    key: "total_ltv",
    label: "Lifetime value ($)",
    kind: "number",
    ops: OPS_NUM,
  },
  {
    key: "opens_30d",
    label: "Opens (last 30d)",
    kind: "number",
    ops: OPS_NUM,
  },
  {
    key: "clicks_30d",
    label: "Clicks (last 30d)",
    kind: "number",
    ops: OPS_NUM,
  },
  {
    key: "first_seen_at",
    label: "First seen",
    kind: "timestamp",
    ops: OPS_TIME,
    helpText: "When they first appeared in Whop",
  },
  {
    key: "last_purchased_at",
    label: "Last paid",
    kind: "timestamp",
    ops: OPS_TIME,
  },
  {
    key: "last_engagement_at",
    label: "Last engagement",
    kind: "timestamp",
    ops: OPS_TIME,
  },
  {
    key: "last_open_at",
    label: "Last email open",
    kind: "timestamp",
    ops: OPS_TIME,
  },
  {
    key: "last_click_at",
    label: "Last email click",
    kind: "timestamp",
    ops: OPS_TIME,
  },
  {
    key: "active_products",
    label: "Active product contains",
    kind: "text",
    ops: OPS_TEXT,
    helpText: "Substring match against comma-joined product titles",
  },
  {
    key: "ever_products",
    label: "Ever owned product contains",
    kind: "text",
    ops: OPS_TEXT,
  },
  {
    key: "custom_tags",
    label: "CRM tag",
    kind: "tags",
    ops: OPS_TAG,
    helpText: "Tags stored on the user record",
  },
] as const;

export const FIELD_BY_KEY: Record<string, FieldDef> = Object.fromEntries(
  FIELDS.map((f) => [f.key, f]),
);

export function opsForField(key: string): Op[] {
  return FIELD_BY_KEY[key]?.ops ?? [];
}

export const OP_LABELS: Record<Op, string> = {
  eq: "is",
  neq: "is not",
  in: "is any of",
  not_in: "is none of",
  gte: "≥",
  lte: "≤",
  gt: ">",
  lt: "<",
  contains: "contains",
  not_contains: "does not contain",
  is_null: "is empty",
  is_not_null: "is set",
  lt_days_ago: "within the last N days",
  gt_days_ago: "more than N days ago",
  tag_includes: "has tag",
  tag_not_includes: "does not have tag",
};

// ---------- Rule / Filter JSON ----------

const RuleSchema = z
  .object({
    field: z.string().min(1),
    op: z.string().min(1),
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
    values: z.array(z.union([z.string(), z.number()])).optional(),
  })
  .superRefine((rule, ctx) => {
    const def = FIELD_BY_KEY[rule.field];
    if (!def) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unknown field: ${rule.field}`,
        path: ["field"],
      });
      return;
    }
    if (!def.ops.includes(rule.op as Op)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Operator "${rule.op}" not valid for ${def.label}`,
        path: ["op"],
      });
      return;
    }
    const op = rule.op as Op;
    const needsValues = op === "in" || op === "not_in";
    const needsNoValue = op === "is_null" || op === "is_not_null";
    if (needsValues) {
      if (!rule.values || rule.values.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${OP_LABELS[op]} requires at least one value`,
          path: ["values"],
        });
      }
    } else if (!needsNoValue) {
      if (rule.value === undefined || rule.value === null || rule.value === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${OP_LABELS[op]} requires a value`,
          path: ["value"],
        });
      }
    }
  });

export const FilterJsonSchema = z.object({
  match: z.enum(["all", "any"]),
  rules: z.array(RuleSchema).min(1, "At least one rule required"),
});

export type Rule = z.infer<typeof RuleSchema>;
export type FilterJson = z.infer<typeof FilterJsonSchema>;

export function describeRule(r: Rule): string {
  const def = FIELD_BY_KEY[r.field];
  const label = def?.label ?? r.field;
  const op = r.op as Op;
  if (op === "is_null")         return `${label} is empty`;
  if (op === "is_not_null")     return `${label} is set`;
  if (op === "in")              return `${label} is any of ${(r.values ?? []).join(", ")}`;
  if (op === "not_in")          return `${label} is none of ${(r.values ?? []).join(", ")}`;
  if (op === "lt_days_ago")     return `${label} within last ${r.value} days`;
  if (op === "gt_days_ago")     return `${label} more than ${r.value} days ago`;
  return `${label} ${OP_LABELS[op]} ${r.value}`;
}
