import { NextResponse } from "next/server";
import { syncSubscribersToMailerLite } from "@/lib/mailerlite/sync";
import { checkSyncSecret } from "@/lib/sync-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const authErr = checkSyncSecret(request);
  if (authErr) return authErr;

  const url = new URL(request.url);
  const chunkSize = parseIntOrUndefined(url.searchParams.get("chunk_size"));
  const maxChunks = parseIntOrUndefined(url.searchParams.get("max_chunks"));
  const offset = parseIntOrUndefined(url.searchParams.get("offset"));

  try {
    const result = await syncSubscribersToMailerLite({ chunkSize, maxChunks, offset });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function parseIntOrUndefined(v: string | null): number | undefined {
  if (!v) return undefined;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}
