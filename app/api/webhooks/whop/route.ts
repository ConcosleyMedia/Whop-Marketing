import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { upsertMembership, upsertPayment, writeActivity } from "@/lib/whop/upsert";
import { applyScoreSafe } from "@/lib/scoring/apply";
import {
  enrollUserInCadence,
  findCadencesForWhopEvent,
  findCadencesForWhopMembership,
} from "@/lib/cadences/enroll";
import { verifyWhopWebhook } from "@/lib/whop/verify-webhook";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.text();
  const headersRaw = Object.fromEntries(request.headers);

  // Verify with our custom verifier (tries multiple key derivations because
  // Whop's UI shows ws_<hex> while their SDK + standardwebhooks expect
  // base64. Different formats get tried until one matches the signature).
  const verifyResult = verifyWhopWebhook(
    body,
    headersRaw,
    process.env.WHOP_WEBHOOK_SECRET,
  );
  if (!verifyResult.ok) {
    console.error(
      `[whop webhook] signature verification failed: ${verifyResult.error}`,
    );
    return NextResponse.json(
      { error: `signature verification failed: ${verifyResult.error}` },
      { status: 400 },
    );
  }
  console.log(
    `[whop webhook] verified using key variant: ${verifyResult.keyVariant}`,
  );

  let event: { id: string; type: string; data: unknown; timestamp?: string };
  try {
    event = JSON.parse(body);
  } catch (err) {
    return NextResponse.json(
      { error: `invalid json: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 },
    );
  }

  const db = createAdminClient();

  const { data: logRow, error: logErr } = await db
    .from("webhook_log")
    .insert({
      source: "whop",
      event_id: event.id,
      event_type: event.type,
      payload: event as unknown as Record<string, unknown>,
    })
    .select("id")
    .single();
  if (logErr) {
    if (logErr.code === "23505") {
      return NextResponse.json({ status: "duplicate", event_id: event.id });
    }
    return NextResponse.json({ error: `log insert failed: ${logErr.message}` }, { status: 500 });
  }
  const logId = logRow.id as string;

  const occurred_at = event.timestamp ?? new Date().toISOString();

  try {
    await dispatch(db, event, occurred_at);
    await db.from("webhook_log").update({ processed_at: new Date().toISOString() }).eq("id", logId);
    return NextResponse.json({ status: "ok", event_id: event.id, event_type: event.type });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.from("webhook_log").update({ error: message }).eq("id", logId);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Wraps cadence enrollment to never throw — webhook dispatch must keep
// going. Errors are logged and swallowed.
async function safeEnrollAll(
  db: ReturnType<typeof createAdminClient>,
  cadenceIds: string[],
  userId: string,
  reason: string,
): Promise<void> {
  for (const cadenceId of cadenceIds) {
    try {
      await enrollUserInCadence(db, cadenceId, userId, { reason });
    } catch (err) {
      console.error(
        `[cadence] enroll user=${userId} cadence=${cadenceId} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

async function dispatch(
  db: ReturnType<typeof createAdminClient>,
  event: { id: string; type: string; data: unknown },
  occurred_at: string,
): Promise<void> {
  const t = event.type;

  if (t.startsWith("membership.")) {
    const m = event.data as Parameters<typeof upsertMembership>[1];
    const result = await upsertMembership(db, m);
    if (!result.membership_id) return;
    const titleByType: Record<string, string> = {
      "membership.activated": "Membership activated",
      "membership.deactivated": "Membership deactivated",
      "membership.cancel_at_period_end_changed": "Membership cancellation scheduled",
    };
    await writeActivity(db, {
      user_id: result.user_id,
      activity_type: t,
      title: titleByType[t] ?? t,
      related_entity_type: "membership",
      related_entity_id: result.membership_id,
      metadata: { event_id: event.id },
      occurred_at,
    });
    if (result.user_id) {
      await applyScoreSafe(db, result.user_id, { reason: t });
    }

    if (result.user_id) {
      const planWhopId =
        (event.data as { plan?: { id?: string } } | null)?.plan?.id ?? null;

      // 1) whop_membership trigger — only on activation, fires the
      //    welcome-style cadences (e.g. Build Room 10-day welcome).
      if (t === "membership.activated") {
        const ids = await findCadencesForWhopMembership(db, planWhopId);
        await safeEnrollAll(
          db,
          ids,
          result.user_id,
          `whop.${t} · plan ${planWhopId ?? "unknown"}`,
        );
      }

      // 2) whop_event trigger — fires for ANY membership.* event whose
      //    type matches the cadence's trigger_config.event_types[]. With
      //    optional payload predicates (e.g., only when
      //    cancel_at_period_end becomes true). This is what powers
      //    cancel-save, past-due rescue, etc.
      const eventCadenceIds = await findCadencesForWhopEvent(
        db,
        t,
        planWhopId,
        event.data,
      );
      await safeEnrollAll(
        db,
        eventCadenceIds,
        result.user_id,
        `whop_event.${t}`,
      );
    }
    return;
  }

  if (t.startsWith("payment.") || t === "refund.succeeded" || t.startsWith("dispute.")) {
    const p = event.data as Parameters<typeof upsertPayment>[1];
    const result = await upsertPayment(db, p);
    if (!result.payment_id) return;
    const titleByType: Record<string, string> = {
      "payment.created": "Payment created",
      "payment.pending": "Payment pending",
      "payment.succeeded": "Payment succeeded",
      "payment.failed": "Payment failed",
      "refund.succeeded": "Payment refunded",
      "dispute.created": "Payment disputed",
      "dispute.updated": "Payment dispute updated",
    };
    await writeActivity(db, {
      user_id: result.user_id,
      activity_type: t,
      title: titleByType[t] ?? t,
      related_entity_type: "payment",
      related_entity_id: result.payment_id,
      metadata: { event_id: event.id, amount: p.total ?? p.amount_after_fees, currency: p.currency },
      occurred_at,
    });
    if (result.user_id) {
      await applyScoreSafe(db, result.user_id, { reason: t });

      // whop_event trigger for payment / refund / dispute events. Powers
      // past-due rescue, refund follow-up, etc.
      const planWhopId =
        (event.data as { plan?: { id?: string } } | null)?.plan?.id ?? null;
      const eventCadenceIds = await findCadencesForWhopEvent(
        db,
        t,
        planWhopId,
        event.data,
      );
      await safeEnrollAll(
        db,
        eventCadenceIds,
        result.user_id,
        `whop_event.${t}`,
      );
    }
    return;
  }
}
