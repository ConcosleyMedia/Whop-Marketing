import Link from "next/link";
import { ArrowLeft, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SegmentBuilder } from "./segment-builder";
import { createSegmentAction } from "../actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function NewSegmentPage(props: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await props.searchParams;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4">
        <Link
          href="/segments"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All segments
        </Link>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">New segment</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Define filter rules, preview matches, then save. Membership is
          materialized on save and can be re-evaluated anytime.
        </p>
      </div>

      {sp.error && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {sp.error}
        </div>
      )}

      <form action={createSegmentAction} className="space-y-5">
        <SegmentBuilder />

        <div className="flex items-center justify-between border-t pt-4">
          <Link
            href="/segments"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Link>
          <Button type="submit" className="gap-1.5">
            <Save className="h-3.5 w-3.5" />
            Save segment
          </Button>
        </div>
      </form>
    </main>
  );
}
