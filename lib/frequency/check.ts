// Frequency capping — the hard rule from the build spec: no user should
// receive more than N campaigns per M days. Seeded rule in migration 0005 is
// (window_days=7, max_emails=2) but the `frequency_caps` table is the source
// of truth and the only one that matters at runtime.
//
// Semantics:
//   - We count `email_events` rows with event_type='sent' per user in the
//     window.
//   - A user at or over max_emails is excluded from the next send — the
//     "next send" is the current campaign being created.
//   - Emails not matching any user row in the DB are passed through (we
//     can't cap what we can't see). The sync step will still verify them.

import type { createAdminClient } from "@/lib/supabase/admin";

type Db = ReturnType<typeof createAdminClient>;

export type FrequencyCapRule = {
  window_days: number;
  max_emails: number;
};

export async function getActiveCap(db: Db): Promise<FrequencyCapRule | null> {
  const { data, error } = await db
    .from("frequency_caps")
    .select("window_days, max_emails")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`frequency cap read failed: ${error.message}`);
  return data as FrequencyCapRule | null;
}

// Given a candidate set of recipient emails, return the subset that have
// already hit or exceeded the cap and should be excluded from the pending
// campaign. Emails are normalized (trimmed, lowercased) throughout.
export async function findCappedEmails(
  db: Db,
  emails: Set<string>,
  rule: FrequencyCapRule,
): Promise<Set<string>> {
  const capped = new Set<string>();
  if (emails.size === 0 || rule.max_emails <= 0) return capped;

  const since = new Date(
    Date.now() - rule.window_days * 86_400_000,
  ).toISOString();
  const emailList = [...emails];
  const chunkSize = 500;

  for (let i = 0; i < emailList.length; i += chunkSize) {
    const chunk = emailList.slice(i, i + chunkSize);

    const { data: userRows, error: uErr } = await db
      .from("users")
      .select("id, email")
      .in("email", chunk);
    if (uErr) throw new Error(`user lookup failed: ${uErr.message}`);

    const idToEmail = new Map<string, string>();
    for (const u of userRows ?? []) {
      idToEmail.set(u.id as string, (u.email as string).trim().toLowerCase());
    }
    if (idToEmail.size === 0) continue;

    const userIds = [...idToEmail.keys()];
    // Cadence sends are exempt — they're an opted-in sequence and bypass the
    // cap. Filter to broadcast sends only (app_cadence_id IS NULL).
    const { data: events, error: eErr } = await db
      .from("email_events")
      .select("user_id")
      .in("user_id", userIds)
      .eq("event_type", "sent")
      .is("app_cadence_id", null)
      .gte("occurred_at", since);
    if (eErr) throw new Error(`email_events read failed: ${eErr.message}`);

    const sentCount = new Map<string, number>();
    for (const ev of events ?? []) {
      const id = ev.user_id as string;
      sentCount.set(id, (sentCount.get(id) ?? 0) + 1);
    }

    for (const [id, email] of idToEmail) {
      if ((sentCount.get(id) ?? 0) >= rule.max_emails) {
        capped.add(email);
      }
    }
  }

  return capped;
}
