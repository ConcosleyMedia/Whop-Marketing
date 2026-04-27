import Link from "next/link";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatMoney, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const SORT_COLUMNS = {
  recent: { column: "last_engagement_at", ascending: false, label: "Last activity" },
  ltv: { column: "total_ltv", ascending: false, label: "LTV" },
  joined: { column: "first_seen_at", ascending: false, label: "Joined" },
  email: { column: "email", ascending: true, label: "Email" },
} as const;

type SortKey = keyof typeof SORT_COLUMNS;

const LIFECYCLE_OPTIONS = ["all", "active", "churned", "lead", "prospect"] as const;

type SearchParams = {
  q?: string;
  lifecycle?: string;
  sort?: string;
  page?: string;
};

function lifecycleTone(
  stage: string | null,
): "default" | "secondary" | "destructive" | "outline" {
  if (stage === "active") return "default";
  if (stage === "churned") return "destructive";
  return "secondary";
}

export default async function UsersPage(props: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await props.searchParams;
  const q = (sp.q ?? "").trim();
  const lifecycle =
    LIFECYCLE_OPTIONS.find((opt) => opt === sp.lifecycle) ?? "all";
  const sortKey = (Object.keys(SORT_COLUMNS) as SortKey[]).includes(
    sp.sort as SortKey,
  )
    ? (sp.sort as SortKey)
    : "recent";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const db = createAdminClient();

  let query = db
    .from("user_marketing_view")
    .select(
      "id, email, name, username, lifecycle_stage, total_ltv, first_seen_at, last_engagement_at, verification_status, active_products, ever_products",
      { count: "exact" },
    );

  if (q) {
    const pattern = `%${q}%`;
    query = query.or(
      `email.ilike.${pattern},name.ilike.${pattern},username.ilike.${pattern}`,
    );
  }
  if (lifecycle !== "all") {
    query = query.eq("lifecycle_stage", lifecycle);
  }

  const sort = SORT_COLUMNS[sortKey];
  query = query
    .order(sort.column, { ascending: sort.ascending, nullsFirst: false })
    .range(offset, offset + PAGE_SIZE - 1);

  const { data, count, error } = await query;
  if (error) throw new Error(`users query failed: ${error.message}`);

  const users = data ?? [];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const buildHref = (overrides: Partial<SearchParams>) => {
    const merged = { q, lifecycle, sort: sortKey, page: String(page), ...overrides };
    const params = new URLSearchParams();
    if (merged.q) params.set("q", merged.q);
    if (merged.lifecycle && merged.lifecycle !== "all") {
      params.set("lifecycle", merged.lifecycle);
    }
    if (merged.sort && merged.sort !== "recent") params.set("sort", merged.sort);
    if (merged.page && merged.page !== "1") params.set("page", merged.page);
    const qs = params.toString();
    return qs ? `/users?${qs}` : "/users";
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total.toLocaleString()} total · page {page} of{" "}
            {totalPages.toLocaleString()}
          </p>
        </div>
      </div>

      <form className="mb-4 flex items-center gap-2" action="/users" method="get">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={q}
            placeholder="Search email, name, or username"
            className="pl-9"
          />
        </div>
        <select
          name="lifecycle"
          defaultValue={lifecycle}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          {LIFECYCLE_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt === "all" ? "All stages" : opt}
            </option>
          ))}
        </select>
        <input type="hidden" name="sort" value={sortKey} />
        <Button type="submit" size="sm">
          Search
        </Button>
        {(q || lifecycle !== "all") && (
          <Link
            href="/users"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            Reset
          </Link>
        )}
      </form>

      <div className="rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-muted-foreground">
            <tr>
              <Th>Email</Th>
              <Th>Name</Th>
              <Th>Products</Th>
              <Th>Stage</Th>
              <ThSort
                active={sortKey === "ltv"}
                href={buildHref({ sort: "ltv", page: "1" })}
              >
                LTV
              </ThSort>
              <ThSort
                active={sortKey === "recent"}
                href={buildHref({ sort: "recent", page: "1" })}
              >
                Last activity
              </ThSort>
              <ThSort
                active={sortKey === "joined"}
                href={buildHref({ sort: "joined", page: "1" })}
              >
                Joined
              </ThSort>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="py-12 text-center text-sm text-muted-foreground"
                >
                  No users match.
                </td>
              </tr>
            ) : (
              users.map((u) => {
                const active = (u.active_products as string | null) ?? "";
                const ever = (u.ever_products as string | null) ?? "";
                const products = active || ever;
                return (
                  <tr
                    key={u.id as string}
                    className="border-b last:border-b-0 hover:bg-muted/30"
                  >
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/users/${u.id}`}
                        className="font-medium text-foreground hover:underline"
                      >
                        {(u.email as string) ?? "—"}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {(u.name as string | null) ??
                        (u.username as string | null) ??
                        "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      {products ? (
                        <span
                          className="inline-block max-w-[260px] truncate align-bottom text-xs text-muted-foreground"
                          title={products}
                        >
                          {products}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant={lifecycleTone(u.lifecycle_stage as string | null)}>
                        {(u.lifecycle_stage as string | null) ?? "unknown"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {formatMoney(u.total_ltv as number | null)}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {formatRelative(u.last_engagement_at as string | null)}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {formatRelative(u.first_seen_at as string | null)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <div className="text-muted-foreground">
            Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of{" "}
            {total.toLocaleString()}
          </div>
          <div className="flex gap-2">
            <Link
              href={buildHref({ page: String(Math.max(1, page - 1)) })}
              aria-disabled={page <= 1}
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                page <= 1 && "pointer-events-none opacity-50",
              )}
            >
              Previous
            </Link>
            <Link
              href={buildHref({ page: String(Math.min(totalPages, page + 1)) })}
              aria-disabled={page >= totalPages}
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                page >= totalPages && "pointer-events-none opacity-50",
              )}
            >
              Next
            </Link>
          </div>
        </div>
      )}
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

function ThSort({
  children,
  href,
  active,
}: {
  children: React.ReactNode;
  href: string;
  active: boolean;
}) {
  return (
    <th className="px-3 py-2 text-left font-medium text-xs uppercase tracking-wide">
      <Link
        href={href}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground",
          active && "text-foreground",
        )}
      >
        {children}
        {active ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronUp className="h-3 w-3 opacity-30" />
        )}
      </Link>
    </th>
  );
}
