import { createHmac, timingSafeEqual } from "node:crypto";

export type NormalizedEvent = {
  type: string;
  subscriber_email: string | null;
  subscriber_id: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  automation_id: string | null;
  clicked_url: string | null;
  bounce_reason: string | null;
  occurred_at: string;
  raw: Record<string, unknown>;
};

export function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signatureHeader.trim(), "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

export function normalizeEvent(raw: Record<string, unknown>): NormalizedEvent {
  const nestedType = asString(raw.type);
  if (nestedType) {
    const sub = asRecord(raw.subscriber) ?? {};
    const camp = asRecord(raw.campaign);
    const auto = asRecord(raw.automation);
    const link = asRecord(raw.link);
    return {
      type: nestedType,
      subscriber_email: asString(sub.email),
      subscriber_id: asString(sub.id),
      campaign_id: asString(camp?.id ?? null),
      campaign_name: asString(camp?.name ?? null),
      automation_id: asString(auto?.id ?? null),
      clicked_url: asString(link?.url ?? raw.url ?? raw.link_url ?? null),
      bounce_reason: asString(raw.reason ?? raw.bounce_reason ?? null),
      occurred_at:
        asString(camp?.date ?? null) ??
        asString(sub.updated_at) ??
        new Date().toISOString(),
      raw,
    };
  }

  const flatType = asString(raw.event);
  if (flatType) {
    return {
      type: flatType,
      subscriber_email: asString(raw.email),
      subscriber_id: asString(raw.id),
      campaign_id: null,
      campaign_name: null,
      automation_id: null,
      clicked_url: null,
      bounce_reason: asString(raw.reason ?? raw.bounce_reason ?? null),
      occurred_at:
        asString(raw.unsubscribed_at) ??
        asString(raw.updated_at) ??
        new Date().toISOString(),
      raw,
    };
  }

  throw new Error("unknown mailerlite event shape");
}

export function extractEvents(body: unknown): Record<string, unknown>[] {
  const b = asRecord(body);
  if (!b) return [];
  if (Array.isArray(b.events)) {
    return (b.events as unknown[]).filter(
      (e): e is Record<string, unknown> => !!asRecord(e),
    );
  }
  return [b];
}

export const MAILERLITE_EVENT_MAP: Record<
  string,
  { email_event_type: string; activity_type: string; title: string } | undefined
> = {
  "campaign.sent": {
    email_event_type: "sent",
    activity_type: "email.sent",
    title: "Email sent",
  },
  "campaign.open": {
    email_event_type: "opened",
    activity_type: "email.opened",
    title: "Email opened",
  },
  "campaign.click": {
    email_event_type: "clicked",
    activity_type: "email.clicked",
    title: "Email link clicked",
  },
  "subscriber.unsubscribed": {
    email_event_type: "unsubscribed",
    activity_type: "email.unsubscribed",
    title: "Unsubscribed from email",
  },
  "subscriber.bounced": {
    email_event_type: "bounced",
    activity_type: "email.bounced",
    title: "Email bounced",
  },
  "subscriber.spam_reported": {
    email_event_type: "spam_reported",
    activity_type: "email.spam_reported",
    title: "Reported email as spam",
  },
};
