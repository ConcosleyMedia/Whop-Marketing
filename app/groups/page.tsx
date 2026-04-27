import Link from "next/link";
import { ArrowRight, Users as UsersIcon } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listGroups } from "@/lib/mailerlite/client";
import { formatRelative } from "@/lib/format";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function GroupsPage() {
  const groups = await listGroups();
  const sorted = [...groups].sort(
    (a, b) => (b.active_count ?? 0) - (a.active_count ?? 0),
  );

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">MailerLite groups</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {groups.length} group{groups.length === 1 ? "" : "s"} · live from MailerLite
        </p>
      </div>

      {sorted.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No groups yet. Create one in MailerLite or run the subscriber sync.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sorted.map((g) => (
            <Card key={g.id} className="transition hover:border-foreground/20">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  <Link
                    href={`/groups/${g.id}`}
                    className="inline-flex items-center gap-1 hover:underline"
                  >
                    <UsersIcon className="h-4 w-4 text-muted-foreground" />
                    {g.name}
                  </Link>
                  <span className="text-sm font-normal text-muted-foreground">
                    {(g.active_count ?? 0).toLocaleString()}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <dl className="grid grid-cols-3 gap-2 text-xs">
                  <Stat label="Sent" value={(g.sent_count ?? 0).toLocaleString()} />
                  <Stat
                    label="Opens"
                    value={g.open_rate?.string ?? "0%"}
                  />
                  <Stat
                    label="Clicks"
                    value={g.click_rate?.string ?? "0%"}
                  />
                  <Stat
                    label="Unsubs"
                    value={(g.unsubscribed_count ?? 0).toLocaleString()}
                  />
                  <Stat
                    label="Bounced"
                    value={(g.bounced_count ?? 0).toLocaleString()}
                  />
                  <Stat
                    label="Spam"
                    value={(g.junk_count ?? 0).toLocaleString()}
                  />
                </dl>
                <div className="flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
                  <span>
                    Created{" "}
                    {g.created_at ? formatRelative(g.created_at) : "—"}
                  </span>
                  <Link
                    href={`/groups/${g.id}`}
                    className="inline-flex items-center gap-0.5 hover:text-foreground"
                  >
                    View
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
