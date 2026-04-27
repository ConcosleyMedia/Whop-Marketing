// Orchestrator: given a user id, fetch their signals, compute a score, persist
// the derived columns on `users`, and — if the temperature or lifecycle
// actually moved — log an activity so the 360° profile can show the change.
//
// This is the single entry point callers should use. Webhook handlers call
// this inline after they finish persisting the event that changed state.

import type { createAdminClient } from "@/lib/supabase/admin";
import { writeActivity } from "@/lib/whop/upsert";
import { computeScore, type ScoreResult } from "./compute";
import { fetchSignals } from "./fetch";
import { WEIGHTS_VERSION } from "./weights";

type Db = ReturnType<typeof createAdminClient>;

export type ApplyScoreOutcome = {
  user_id: string;
  score: ScoreResult;
  changed: boolean;
  skipped?: "user_not_found";
};

export async function applyScore(
  db: Db,
  userId: string,
  options: { now?: Date; reason?: string } = {},
): Promise<ApplyScoreOutcome> {
  const now = options.now ?? new Date();

  const { data: current, error: readErr } = await db
    .from("users")
    .select(
      "id, lead_score, lead_temperature, lifecycle_stage, total_ltv, last_engagement_at",
    )
    .eq("id", userId)
    .maybeSingle();
  if (readErr) throw new Error(`users read failed: ${readErr.message}`);
  if (!current) {
    return {
      user_id: userId,
      score: {
        leadScore: 0,
        leadTemperature: "at_risk",
        lifecycleStage: "prospect",
        breakdown: [],
      },
      changed: false,
      skipped: "user_not_found",
    };
  }

  const signals = await fetchSignals(db, userId, now);
  const score = computeScore(signals, now);

  const prevScore = current.lead_score ?? 0;
  const prevTemp = current.lead_temperature ?? null;
  const prevLife = current.lifecycle_stage ?? null;
  const prevLtv = current.total_ltv != null ? Number(current.total_ltv) : 0;
  const prevEngagement = current.last_engagement_at ?? null;
  const newLtv = Math.round(signals.totalLtv * 100) / 100; // 2dp — matches users.total_ltv NUMERIC(10,2)
  const newEngagementIso = signals.lastEngagementAt
    ? signals.lastEngagementAt.toISOString()
    : null;

  const scoreChanged = prevScore !== score.leadScore;
  const tempChanged = prevTemp !== score.leadTemperature;
  const lifeChanged = prevLife !== score.lifecycleStage;
  const ltvChanged = prevLtv !== newLtv;
  const engagementChanged = prevEngagement !== newEngagementIso;
  const anyChange =
    scoreChanged || tempChanged || lifeChanged || ltvChanged || engagementChanged;

  if (anyChange) {
    const { error: updErr } = await db
      .from("users")
      .update({
        lead_score: score.leadScore,
        lead_temperature: score.leadTemperature,
        lifecycle_stage: score.lifecycleStage,
        total_ltv: newLtv,
        last_engagement_at: newEngagementIso,
        updated_at: now.toISOString(),
      })
      .eq("id", userId);
    if (updErr) throw new Error(`users update failed: ${updErr.message}`);
  }

  // Log a score-changed activity only when a bucket crossed — every email
  // open would otherwise churn activities.
  if (tempChanged || lifeChanged) {
    await writeActivity(db, {
      user_id: userId,
      activity_type: "score.changed",
      title: buildTitle(prevTemp, score.leadTemperature, prevLife, score.lifecycleStage),
      description: `Score ${prevScore} → ${score.leadScore}`,
      metadata: {
        prev_score: prevScore,
        new_score: score.leadScore,
        prev_temperature: prevTemp,
        new_temperature: score.leadTemperature,
        prev_lifecycle: prevLife,
        new_lifecycle: score.lifecycleStage,
        breakdown: score.breakdown,
        weights_version: WEIGHTS_VERSION,
        reason: options.reason ?? null,
      },
      occurred_at: now.toISOString(),
    });
  }

  return { user_id: userId, score, changed: anyChange };
}

function buildTitle(
  prevTemp: string | null,
  newTemp: string,
  prevLife: string | null,
  newLife: string,
): string {
  if (prevLife !== newLife && prevLife !== null) {
    return `Lifecycle: ${prevLife} → ${newLife}`;
  }
  if (prevTemp !== newTemp && prevTemp !== null) {
    return `Temperature: ${prevTemp} → ${newTemp}`;
  }
  // First-time score (no prev values). Pick whichever is more informative.
  return `Scored: ${newLife} · ${newTemp}`;
}

// Safe wrapper for webhook call sites — never throw, just log. A scoring
// failure should not fail the webhook and trigger a MailerLite/Whop retry.
export async function applyScoreSafe(
  db: Db,
  userId: string,
  options: { now?: Date; reason?: string } = {},
): Promise<ApplyScoreOutcome | null> {
  try {
    return await applyScore(db, userId, options);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[scoring] applyScore(${userId}) failed: ${msg}`);
    return null;
  }
}
