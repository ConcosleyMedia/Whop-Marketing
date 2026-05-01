# Agent Task — Lifecycle Cadence Seeds

**Branch:** `feat/cancel-save-cadence`
**Status:** Phase 1 of the §18 priority list (`docs/SYSTEM.md`)
**Owner:** Claude (executing self)

---

## Why this exists

Commit [3e4c1bb](https://github.com/ConcosleyMedia/Whop-Marketing/commit/3e4c1bb)
shipped the runtime engine for two new cadence primitives:

1. **`whop_event` trigger type** — cadences fire on any Whop webhook event
2. **Per-step `exit_if` conditions** — drop out mid-flow when user state changes

The engine is wired up in `lib/cadences/{enroll,run,exit-conditions,types}.ts`
and `app/api/webhooks/whop/route.ts`. **But there is currently zero usage** —
no seeded cadence demonstrates either feature, and the cadence builder UI
does not yet expose them. The commit message claimed a cancel-save cadence
was seeded; it wasn't.

This task closes that gap by seeding three placeholder lifecycle cadences,
each one a real-world reason the new primitives exist.

## Out of scope

- **Cadence builder UI.** Authoring cadences via SQL migration remains the
  canonical path until a v2 builder lands. Detail page (`/cadences/[id]`)
  already renders any cadence the seed creates.
- **Filling in real email copy.** Operator (Kevin / cozzy) will populate
  template HTML themselves — see "Placeholder convention" below.

---

## What this migration adds

`supabase/migrations/0015_seed_lifecycle_cadences.sql` inserts:

### 9 placeholder email templates

| Cadence | Step | Template name | Labels |
|---|---|---|---|
| Cancel-save | Day 0 | `Cancel-save · Day 0 (immediate)` | `cancel-save`, `lifecycle`, `day-00` |
| Cancel-save | Day 2 | `Cancel-save · Day 2` | `cancel-save`, `lifecycle`, `day-02` |
| Cancel-save | Day 5 | `Cancel-save · Day 5 (last call)` | `cancel-save`, `lifecycle`, `day-05` |
| Past-due rescue | Day 1 | `Past-due rescue · Day 1` | `past-due`, `lifecycle`, `day-01` |
| Past-due rescue | Day 3 | `Past-due rescue · Day 3` | `past-due`, `lifecycle`, `day-03` |
| Past-due rescue | Day 7 | `Past-due rescue · Day 7 (last attempt)` | `past-due`, `lifecycle`, `day-07` |
| Win-back | Day 0 | `Win-back · Day 0 (we miss you)` | `winback`, `lifecycle`, `day-00` |
| Win-back | Day 7 | `Win-back · Day 7 (here's what's new)` | `winback`, `lifecycle`, `day-07` |
| Win-back | Day 14 | `Win-back · Day 14 (last touch)` | `winback`, `lifecycle`, `day-14` |

### 3 cadences (status=`draft`, won't fire until operator activates)

**1. Cancel save · 3-touch save flow** — `whop_event` trigger
- `event_types: ["membership.cancel_at_period_end_changed"]`
- `payload_path: "cancel_at_period_end"`, `payload_value: true` — fires *only* on actual cancel, not un-cancel
- 3 steps: Day 0 immediate, Day 2 (48h), Day 5 (120h after enrollment)
- Each step `exit_if`: `any_cancel_at_period_end is_false` — bails the moment they un-cancel

**2. Past-due rescue · payment recovery** — `whop_event` trigger
- `event_types: ["payment.failed"]`
- 3 steps: Day 1 (24h), Day 3 (72h), Day 7 (168h)
- Each step `exit_if`: `any_past_due_membership is_false` — bails when card succeeds

**3. Win-back · 60-day re-engagement** — `segment_added` trigger
- Filters to a placeholder `segment_id` the operator wires post-deploy
- 3 steps: Day 0, Day 7, Day 14
- Each step `exit_if`: `lifecycle_stage neq churned` — bails when they re-purchase

## Placeholder convention

Each template's `html` column ships with a minimal HTML shell containing:
- A `PLACEHOLDER` banner with cadence + day labels
- Inline notes listing available `{{KEY}}` variables (`WHOP_BUILDROOM_URL`,
  `WHOP_FREE_URL`, `SENDER_NAME`, etc.)
- A `[FirstName]` MailerLite native token to confirm the merge path works
- A neutral `{{$unsubscribe}}` footer

`suggested_subject` and `preview_text` are placeholder strings the operator
will overwrite. No copy is committed.

## Verification

After deploy:

1. `select count(*) from email_templates where 'lifecycle' = any(labels);` → 9
2. `select name, trigger_type, status from cadences where status='draft' order by created_at desc limit 3;` → all 3 visible
3. `/cadences` page renders 3 new draft rows
4. `/templates` filterable by labels `cancel-save`, `past-due`, `winback`
5. Operator activates one cadence (e.g. cancel-save), simulates a Whop cancel
   webhook → enrollment row appears in `cadence_enrollments`
6. Operator un-cancels (fires `cancel_at_period_end_changed` with `false`) →
   on next 15-min cron run, enrollment exits with reason `un-cancelled`

## Follow-ups (separate tasks)

- §18 #3: Segment-exit triggers (symmetric with `segment_added`)
- §18 #4: Step branching (`next_if(cond)`)
- §18 #5: Non-email action types (tag user, fire webhook)
- Optional v2: cadence builder UI exposing `whop_event` config + `exit_if`
  per-step editor. Not needed yet; SQL migration is fine as the authoring
  path while there are <10 cadences.
