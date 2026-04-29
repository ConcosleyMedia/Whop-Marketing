// Custom Whop webhook verifier.
//
// Whop says they "follow the standardwebhooks spec," but their dashboard
// hands operators secrets in `ws_<64 hex chars>` format and the bundled
// @whop/sdk's `unwrap()` couldn't verify our test events even after we
// translated to base64. The mismatch is almost certainly in how Whop derives
// the HMAC key from the visible secret string.
//
// Rather than guess once, we try every plausible key derivation and return
// the first that produces a matching signature. The signed message itself
// follows the standardwebhooks construction:
//
//   toSign = `${msg_id}.${timestamp}.${body}`
//   header = `v1,${base64(hmacSHA256(key, toSign))}`
//
// Headers (lowercased): webhook-id, webhook-timestamp, webhook-signature.

import { createHmac, timingSafeEqual } from "node:crypto";

export type WhopWebhookHeaders = {
  "webhook-id"?: string;
  "webhook-timestamp"?: string;
  "webhook-signature"?: string;
} & Record<string, string | undefined>;

const TOLERANCE_SECONDS = 5 * 60;

export type VerifyResult =
  | { ok: true; keyVariant: string }
  | { ok: false; error: string; tried: string[] };

function strippedPrefix(secret: string): string {
  if (secret.startsWith("whsec_")) return secret.slice(6);
  if (secret.startsWith("ws_")) return secret.slice(3);
  return secret;
}

// Build the candidate raw HMAC keys we'll try. Order matters — most likely
// first.
function candidateKeys(secret: string): Array<{ name: string; key: Buffer }> {
  const cleaned = secret.trim().replace(/^["']|["']$/g, "").split(/\s+/)[0];
  if (!cleaned) return [];
  const stripped = strippedPrefix(cleaned);
  const out: Array<{ name: string; key: Buffer }> = [];

  // 1. Whop UI shows `ws_<64 hex>` — hex-decode the suffix to 32 raw bytes
  if (/^[0-9a-fA-F]+$/.test(stripped) && stripped.length % 2 === 0) {
    out.push({ name: "hex(stripped)", key: Buffer.from(stripped, "hex") });
  }
  // 2. UTF-8 bytes of the suffix (treating "ws_..." as a passphrase string)
  out.push({ name: "utf8(stripped)", key: Buffer.from(stripped, "utf8") });
  // 3. UTF-8 bytes of the whole thing, prefix included
  out.push({ name: "utf8(full)", key: Buffer.from(cleaned, "utf8") });
  // 4. base64-decode the suffix
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(stripped)) {
    try {
      const buf = Buffer.from(stripped, "base64");
      if (buf.length > 0) out.push({ name: "base64(stripped)", key: buf });
    } catch {
      /* ignore */
    }
  }
  return out;
}

function constantTimeMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

export function verifyWhopWebhook(
  body: string,
  headers: WhopWebhookHeaders,
  secret: string | null | undefined,
): VerifyResult {
  if (!secret) {
    return { ok: false, error: "WHOP_WEBHOOK_SECRET not set", tried: [] };
  }
  const lower: Record<string, string> = {};
  for (const k of Object.keys(headers)) {
    const v = headers[k];
    if (typeof v === "string") lower[k.toLowerCase()] = v;
  }

  const id = lower["webhook-id"];
  const ts = lower["webhook-timestamp"];
  const sigHeader = lower["webhook-signature"];

  if (!id || !ts || !sigHeader) {
    return {
      ok: false,
      error: `Missing required webhook headers (id=${!!id}, ts=${!!ts}, sig=${!!sigHeader})`,
      tried: [],
    };
  }

  const tsNum = parseInt(ts, 10);
  if (!Number.isFinite(tsNum)) {
    return { ok: false, error: `Invalid webhook-timestamp: ${ts}`, tried: [] };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsNum) > TOLERANCE_SECONDS) {
    return {
      ok: false,
      error: `webhook-timestamp ${tsNum} outside tolerance (now=${nowSec})`,
      tried: [],
    };
  }

  const toSign = `${id}.${ts}.${body}`;
  const candidates = candidateKeys(secret);
  if (candidates.length === 0) {
    return { ok: false, error: "Empty secret after normalization", tried: [] };
  }

  const tried: string[] = [];
  for (const { name, key } of candidates) {
    const computed = createHmac("sha256", key).update(toSign).digest("base64");
    tried.push(name);
    // The header is space-separated list of "v<n>,<sig>" pairs. We accept
    // a match against any v1 entry.
    for (const part of sigHeader.split(" ")) {
      const [version, sig] = part.split(",");
      if (version !== "v1" || !sig) continue;
      if (constantTimeMatch(sig, computed)) {
        return { ok: true, keyVariant: name };
      }
    }
  }

  return {
    ok: false,
    error: `No key derivation produced a matching signature. Tried: ${tried.join(", ")}`,
    tried,
  };
}
