import { Whop } from "@whop/sdk";

let cached: Whop | null = null;

// Whop's dashboard hands operators a webhook signing secret formatted as
// "ws_<64 hex chars>", but the @whop/sdk under the hood uses the
// standardwebhooks library which expects the secret as base64 (with optional
// "whsec_" prefix). Translate ws_-hex → raw bytes → base64 so the operator
// can paste exactly what Whop shows them without any manual conversion.
function normalizeWhopWebhookSecret(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^["']|["']$/g, "").split(/\s+/)[0];
  if (!trimmed) return null;
  if (trimmed.startsWith("ws_")) {
    const hex = trimmed.slice(3);
    if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0) {
      return Buffer.from(hex, "hex").toString("base64");
    }
  }
  // Already in standardwebhooks-compatible form (whsec_<base64> or plain
  // base64). Pass through.
  return trimmed;
}

export function getWhopClient(): Whop {
  if (cached) return cached;
  const apiKey = process.env.WHOP_API_KEY;
  if (!apiKey) throw new Error("Missing WHOP_API_KEY env var");
  cached = new Whop({
    apiKey,
    webhookKey: normalizeWhopWebhookSecret(process.env.WHOP_WEBHOOK_SECRET),
  });
  return cached;
}

export function getWhopCompanyId(): string {
  const id = process.env.WHOP_COMPANY_ID;
  if (!id) throw new Error("Missing WHOP_COMPANY_ID env var");
  return id;
}
