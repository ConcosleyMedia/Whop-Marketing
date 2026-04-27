import { NextResponse } from "next/server";

export function checkSyncSecret(request: Request): NextResponse | null {
  const expected = process.env.SYNC_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "SYNC_SECRET not configured" }, { status: 503 });
  }
  const provided = request.headers.get("x-sync-secret");
  if (provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
