import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWhopClient } from "@/lib/whop/client";
import { upsertMembership, upsertPayment, writeActivity } from "@/lib/whop/upsert";
import { applyScoreSafe } from "@/lib/scoring/apply";
import { enrollUserInCadence, findCadencesForWhopMembership } from "@/lib/cadences/enroll";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.text();
  const headers = Object.fromEntries(request.headers);

  let event: { id: string; type: string; data: unknown; timestamp?: string };
  try {
    const whop = getWhopClient();
    event = whop.webhooks.unwrap(body, { headers }) as typeof event;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `signature verification failed: ${message}` }, { status: 400 });
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

    // Auto-enroll new memberships into matching cadences. Only on activation
    // events — we don't want re-enrollments on cancel/uncancel toggles.
    if (t === "membership.activated" && result.user_id) {
      const planWhopId =
        (event.data as { plan?: { id?: string } } | null)?.plan?.id ?? null;
      const cadenceIds = await findCadencesForWhopMembership(db, planWhopId);
      for (const cadenceId of cadenceIds) {
        try {
          await enrollUserInCadence(db, cadenceId, result.user_id, {
            reason: `whop.${t} · plan ${planWhopId ?? "unknown"}`,
          });
        } catch (err) {
          // Don't fail the webhook on enrollment errors — just log.
          console.error(
            `[cadence] enroll user=${result.user_id} cadence=${cadenceId} failed:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
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
    }
    return;
  }
}
