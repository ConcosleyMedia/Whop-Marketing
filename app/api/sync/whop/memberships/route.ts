import { NextResponse } from "next/server";
import { syncMemberships } from "@/lib/whop/sync";
import { checkSyncSecret } from "@/lib/sync-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

export async function POST(request: Request) {
  const authErr = checkSyncSecret(request);
  if (authErr) return authErr;

  try {
    const result = await syncMemberships();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
