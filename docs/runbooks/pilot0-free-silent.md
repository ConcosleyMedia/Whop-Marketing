# Pilot 0 — Free silent reactivation runbook

**Issue:** [ConcosleyMedia/Whop-Marketing#3](https://github.com/ConcosleyMedia/Whop-Marketing/issues/3)
**Cadence:** `Pilot 0 · Free silent reactivation (4-touch)` (id `22222222-2222-2222-2222-f00000000001`)
**Audience:** 400 most-recently-joined Free silent users (`lifecycle=churned`, `total_ltv=0`), excluding anyone already enrolled in the existing welcome cadence.
**Schedule:** ~100 enrollments/day × 4 days. Total 14-day cycle (Day 0 → Day 14) per enrollee.
**Voice source:** `BuildRoom_Email_Whitepaper.docx`

---

## Pre-flight (do once, before Day 1)

1. **Confirm migration is live** in production:
   ```sql
   select count(*) from email_templates where 'pilot-0' = any(labels);  -- expect 4
   select id, status, name from cadences where id = '22222222-2222-2222-2222-f00000000001';  -- expect status='active'
   select id, name, member_count from segments where id = '33333333-3333-3333-3333-f00000000001';
   ```

2. **Force segment evaluation** so `member_count` reflects today's data (the hourly orchestrator does this on its own, but you can trigger it manually):
   ```bash
   curl -X POST https://<domain>/api/cron/orchestrator -H "x-sync-secret: $SYNC_SECRET"
   ```
   Then re-run the segment query — `member_count` should be in the thousands.

3. **Force a rescore** if recent signups are showing null `lifecycle_stage`:
   ```bash
   curl -X POST 'https://<domain>/api/sync/rescore?limit=500' -H "x-sync-secret: $SYNC_SECRET"
   ```
   Otherwise the nightly rescore (`17 8 * * *` UTC) catches them on the next pass. The Day 1 enrollment query filters to `lifecycle_stage = 'churned'` defensively, so a stale subset just defers eligibility — nobody enrolls in a broken state.

3. **Render-test all 4 templates** in `/templates` (filter label `pilot-0`). Send a test to your own inbox via the editor's Send Test form. Check on desktop Gmail and iOS Mail at minimum.

4. **Sender warmth:** confirm MailerLite reports the sender domain as warm. Pilot 0 sends ~400 emails over 18 days — well within tolerance, but if the domain has been quiet for >30 days, send a small (50-recipient) internal warm-up campaign first.

---

## Daily enrollment — Day 1 to Day 4

Run this once per day, mid-morning (after the segment has been re-evaluated by the hourly orchestrator at `:23`). Inserts ~100 fresh enrollments.

```sql
-- Pilot 0 daily enrollment.
-- Selects 100 newest Free-silent users not yet in either:
--   • the Free signup welcome cadence (id 9bdb0f77-...)
--   • Pilot 0 itself (avoid duplicates across days)
-- "Newest" = users.first_seen_at DESC (most recent Whop signup first).
--
-- IMPORTANT: requires u.lifecycle_stage = 'churned' explicitly. The segment
-- uses segment_eligibility_view which derives lifecycle on-the-fly, but the
-- cadence's exit_if reads users.lifecycle_stage at runtime. Recently
-- backfilled users can be in the segment yet have a null lifecycle_stage —
-- enrolling them would trigger immediate exit (null != 'churned' is true).
-- The nightly rescore (08:17 UTC) populates these; this filter is defensive.

WITH pilot AS (SELECT '22222222-2222-2222-2222-f00000000001'::uuid AS cadence_id),
candidates AS (
  SELECT u.id AS user_id
  FROM users u
  JOIN segment_members sm
    ON sm.user_id = u.id
   AND sm.segment_id = '33333333-3333-3333-3333-f00000000001'::uuid
  WHERE u.lifecycle_stage = 'churned'
    AND u.id NOT IN (
      SELECT user_id FROM cadence_enrollments
      WHERE cadence_id IN (
        '9bdb0f77-2871-4ad9-baab-c7ed695860b8'::uuid,         -- Free signup welcome
        (SELECT cadence_id FROM pilot)                         -- Pilot 0 itself
      )
    )
  ORDER BY u.first_seen_at DESC NULLS LAST
  LIMIT 100
)
INSERT INTO cadence_enrollments
  (cadence_id, user_id, current_step, status, enrolled_at, next_action_at)
SELECT
  (SELECT cadence_id FROM pilot),
  user_id,
  0,
  'active',
  NOW(),
  NOW()  -- step 0 has delay_hours=0, fires on the next 15-min cron tick
FROM candidates
ON CONFLICT (cadence_id, user_id) DO NOTHING
RETURNING user_id;
```

Capture the row count returned. Expected: 100/day. If <100, the candidate pool is exhausting and you may need to widen ordering or accept fewer.

After the insert, the cadence cron (`*/15 * * * *`) picks up the enrollment within 15 minutes and sends Day 0. Day 3 / Day 7 / Day 14 fire automatically as `next_action_at` rolls forward.

---

## Daily monitoring — every morning during the rollout

Bookmark and run all four queries. Compare against thresholds in the next section.

### A. Sends + bounces + complaints, last 24h

```sql
SELECT
  date_trunc('day', occurred_at)::date AS day,
  COUNT(*) FILTER (WHERE event_type = 'sent')          AS sent,
  COUNT(*) FILTER (WHERE event_type = 'bounced')       AS bounced,
  COUNT(*) FILTER (WHERE event_type = 'spam_reported') AS complaints,
  COUNT(*) FILTER (WHERE event_type = 'unsubscribed')  AS unsubs,
  COUNT(*) FILTER (WHERE event_type = 'opened')        AS opens,
  COUNT(*) FILTER (WHERE event_type = 'clicked')       AS clicks
FROM email_events
WHERE app_cadence_id = '22222222-2222-2222-2222-f00000000001'
  AND occurred_at > NOW() - INTERVAL '24 hours'
GROUP BY 1 ORDER BY 1 DESC;
```

### B. Cumulative breakdown by step

```sql
SELECT
  COALESCE(metadata->>'step_index', '?') AS step,
  COUNT(*) FILTER (WHERE event_type = 'sent')          AS sent,
  COUNT(*) FILTER (WHERE event_type = 'opened')        AS opens,
  COUNT(*) FILTER (WHERE event_type = 'clicked')       AS clicks,
  COUNT(*) FILTER (WHERE event_type = 'bounced')       AS bounced,
  COUNT(*) FILTER (WHERE event_type = 'spam_reported') AS complaints
FROM email_events
WHERE app_cadence_id = '22222222-2222-2222-2222-f00000000001'
GROUP BY 1 ORDER BY 1;
```

### C. Active vs exited enrollments

```sql
SELECT status, COUNT(*) AS n,
       MIN(enrolled_at)::date AS first_enrolled,
       MAX(enrolled_at)::date AS last_enrolled
FROM cadence_enrollments
WHERE cadence_id = '22222222-2222-2222-2222-f00000000001'
GROUP BY status;
```

### D. Exits by reason (sanity-check `exit_if`)

```sql
SELECT exit_reason, COUNT(*) AS n
FROM cadence_enrollments
WHERE cadence_id = '22222222-2222-2222-2222-f00000000001'
  AND status = 'exited'
GROUP BY 1 ORDER BY 2 DESC;
```

---

## Pre-committed abort thresholds

Per ADR-0001 + MailerLite AUP. Computed from the rolling 24h window (query A above).

| Metric | Yellow (pause + investigate) | Red (abort) |
|---|---|---|
| Hard bounce rate | 2–4% of sent | >4% of sent |
| Spam complaints | 1+ per ≥200 sent | ≥1 per 100 sent |
| Unsubscribe rate | 2–5% of sent | >5% of sent |
| Open rate | <5% on a given step | <3% across the cohort |

**On yellow:** stop daily enrollments. Review query B for which step is leaking. Check if a specific batch (one day's enrollment cohort) is the source. Hold for 24h; resume only if numbers normalize.

**On red:** stop daily enrollments AND set the cadence to `paused`:
```sql
UPDATE cadences SET status = 'paused' WHERE id = '22222222-2222-2222-2222-f00000000001';
```
This stops further sends but leaves enrolled users in their current state — operator decides next move (resume vs. mark all enrollments completed).

---

## Wrap-up — Day 18 (4 days after final cohort's Day 14)

By Day 18 every enrolled user has received Day 14 or exited. Capture final metrics:

```sql
-- Conversion: did the user buy anything during the cycle?
WITH enrolled AS (
  SELECT user_id, enrolled_at
  FROM cadence_enrollments
  WHERE cadence_id = '22222222-2222-2222-2222-f00000000001'
)
SELECT
  COUNT(*)                                                          AS total_enrolled,
  COUNT(*) FILTER (WHERE u.lifecycle_stage = 'active')              AS now_active,
  COUNT(*) FILTER (WHERE u.total_ltv > 0)                           AS now_paying,
  COUNT(*) FILTER (WHERE p.user_id IS NOT NULL)                     AS bought_during_cycle
FROM enrolled e
JOIN users u ON u.id = e.user_id
LEFT JOIN payments p
  ON p.user_id = e.user_id
 AND p.status = 'paid'
 AND p.paid_at >= e.enrolled_at;
```

```sql
-- Engagement totals
SELECT
  COUNT(DISTINCT user_id) FILTER (WHERE event_type='opened')  AS uniq_openers,
  COUNT(DISTINCT user_id) FILTER (WHERE event_type='clicked') AS uniq_clickers,
  SUM(CASE WHEN event_type='sent' THEN 1 ELSE 0 END)          AS total_sends
FROM email_events
WHERE app_cadence_id = '22222222-2222-2222-2222-f00000000001';
```

Record the result on issue #3 before closing. The numbers feed into the go/no-go decision for issue #8 (full Free-silent expansion to ~14,600).

---

## Rollback

If the migration was applied but something is wrong with the templates and you need to retract:

```sql
-- Stops further sends without nuking history
UPDATE cadences SET status = 'paused' WHERE id = '22222222-2222-2222-2222-f00000000001';

-- Optional, harder rollback (will fail if any enrollments reference the cadence;
-- delete those first if you really want to wipe)
-- DELETE FROM cadences WHERE id = '22222222-2222-2222-2222-f00000000001';
-- DELETE FROM email_templates WHERE 'pilot-0' = ANY(labels);
-- DELETE FROM segments WHERE id = '33333333-3333-3333-3333-f00000000001';
```
