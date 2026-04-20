import Link from "next/link";
import { ArrowRight, Filter } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listSegments } from "@/lib/mailerlite/client";
import { formatRelative } from "@/lib/format";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SegmentsPage() {
  const segments = await listSegments();
  const sorted = [...segments].sort(
    (a, b) => (b.total ?? 0) - (a.total ?? 0),
  );

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-4">
        <Link
          href="/segments"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          ← CRM segments
        </Link>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          MailerLite-native segments
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {segments.length} segment{segments.length === 1 ? "" : "s"} · read-only view of segments built inside MailerLite
        </p>
      </div>

      {sorted.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No segments yet. Create one in MailerLite (Subscribers → Segments →
            New segment).
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sorted.map((s) => (
            <Card key={s.id} className="transition hover:border-foreground/20">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  <Link
                    href={`/segments/mailerlite/${s.id}`}
                    className="inline-flex items-center gap-1 hover:underline"
                  >
                    <Filter className="h-4 w-4 text-muted-foreground" />
                    {s.name}
                  </Link>
                  <span className="text-sm font-normal text-muted-foreground">
                    {(s.total ?? 0).toLocaleString()}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <Stat
                    label="Subscribers"
                    value={(s.total ?? 0).toLocaleString()}
                  />
                  <Stat label="Open rate" value={s.open_rate?.string ?? "—"} />
                  <Stat label="Click rate" value={s.click_rate?.string ?? "—"} />
                  <Stat
                    label="Created"
                    value={s.created_at ? formatRelative(s.created_at) : "—"}
                  />
                </dl>
                <div className="flex items-center justify-end border-t pt-2 text-xs text-muted-foreground">
                  <Link
                    href={`/segments/mailerlite/${s.id}`}
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
