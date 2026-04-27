import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  MAILERLITE_EVENT_MAP,
  extractEvents,
  normalizeEvent,
  verifySignature,
  type NormalizedEvent,
} from "@/lib/mailerlite/webhook";
import { writeActivity } from "@/lib/whop/upsert";
import { applyScoreSafe } from "@/lib/scoring/apply";

export const dynamic = "force-dynamic";

type Db = ReturnType<typeof createAdminClient>;

export async function POST(request: Request) {
  const secret = process.env.MAILERLITE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "MAILERLITE_WEBHOOK_SECRET not set" },
      { status: 500 },
    );
  }

  const rawBody = await request.text();
  const signature = request.headers.get("signature");

  if (!verifySignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const rawEvents = extractEvents(parsed);
  if (rawEvents.length === 0) {
    return NextResponse.json({ status: "empty" });
  }

  const db = createAdminClient();
  const dedupeKey = signature ?? "";

  const { data: logRow, error: logErr } = await db
    .from("webhook_log")
    .insert({
      source: "mailerlite",
      event_id: dedupeKey,
      event_type: rawEvents[0]?.type ?? rawEvents[0]?.event ?? null,
      payload: parsed as Record<string, unknown>,
    })
    .select("id")
    .single();
  if (logErr) {
    if (logErr.code === "23505") {
      return NextResponse.json({ status: "duplicate" });
    }
    return NextResponse.json(
      { error: `log insert failed: ${logErr.message}` },
      { status: 500 },
    );
  }
  const logId = logRow.id as string;

  const results: Array<{ type: string; status: string; reason?: string }> = [];
  try {
    for (const raw of rawEvents) {
      const ev = normalizeEvent(raw);
      const outcome = await handleEvent(db, ev);
      results.push({ type: ev.type, ...outcome });
    }
    await db
      .from("webhook_log")
      .update({ processed_at: new Date().toISOString() })
      .eq("id", logId);
    return NextResponse.json({ status: "ok", events: results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.from("webhook_log").update({ error: message }).eq("id", logId);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handleEvent(
  db: Db,
  ev: NormalizedEvent,
): Promise<{ status: string; reason?: string }> {
  const mapped = MAILERLITE_EVENT_MAP[ev.type];
  if (!mapped) return { status: "skipped", reason: "unhandled_type" };
  if (!ev.subscriber_email) {
    return { status: "skipped", reason: "no_subscriber_email" };
  }

  const { data: userRow, error: userErr } = await db
    .from("users")
    .select("id")
    .eq("email", ev.subscriber_email)
    .maybeSingle();
  if (userErr) throw new Error(`user lookup failed: ${userErr.message}`);
  if (!userRow) return { status: "skipped", reason: "user_not_found" };

  const user_id = userRow.id as string;

  const { data: emailRow, error: emailErr } = await db
    .from("email_events")
    .insert({
      user_id,
      event_type: mapped.email_event_type,
      mailerlite_campaign_id: ev.campaign_id,
      mailerlite_automation_id: ev.automation_id,
      email_subject: ev.campaign_name,
      clicked_url: ev.clicked_url,
      bounce_reason: ev.bounce_reason,
      metadata: {
        mailerlite_event: ev.type,
        subscriber_id: ev.subscriber_id,
        raw: ev.raw,
      },
      occurred_at: ev.occurred_at,
    })
    .select("id")
    .single();
  if (emailErr) throw new Error(`email_event insert failed: ${emailErr.message}`);

  const description = ev.clicked_url ?? ev.campaign_name ?? null;
  await writeActivity(db, {
    user_id,
    activity_type: mapped.activity_type,
    title: ev.campaign_name ? `${mapped.title}: ${ev.campaign_name}` : mapped.title,
    description,
    related_entity_type: "email_event",
    related_entity_id: emailRow.id as string,
    metadata: {
      mailerlite_event: ev.type,
      campaign_id: ev.campaign_id,
      automation_id: ev.automation_id,
      clicked_url: ev.clicked_url,
    },
    occurred_at: ev.occurred_at,
  });

  await applyScoreSafe(db, user_id, { reason: `mailerlite.${ev.type}` });

  return { status: "ok" };
}
