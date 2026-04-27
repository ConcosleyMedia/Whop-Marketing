import { NextResponse } from "next/server";
import { backfillVerification } from "@/lib/mailercheck/backfill";
import { checkSyncSecret } from "@/lib/sync-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const authErr = checkSyncSecret(request);
  if (authErr) return authErr;

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dry_run") === "true";
  const chunkSizeParam = url.searchParams.get("chunk_size");
  const chunkSize = chunkSizeParam ? parseInt(chunkSizeParam, 10) : undefined;

  try {
    const result = await backfillVerification({ chunkSize, dryRun });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
