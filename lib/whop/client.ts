import { Whop } from "@whop/sdk";

let cached: Whop | null = null;

export function getWhopClient(): Whop {
  if (cached) return cached;
  const apiKey = process.env.WHOP_API_KEY;
  if (!apiKey) throw new Error("Missing WHOP_API_KEY env var");
  cached = new Whop({ apiKey, webhookKey: process.env.WHOP_WEBHOOK_SECRET ?? null });
  return cached;
}

export function getWhopCompanyId(): string {
  const id = process.env.WHOP_COMPANY_ID;
  if (!id) throw new Error("Missing WHOP_COMPANY_ID env var");
  return id;
}
