# Whop CRM — System Documentation

A purpose-built CRM and email-marketing platform for a Whop-powered business.
Whop is the system of record for commerce, MailerLite is the send engine,
MailerCheck is the verifier, this app is the brain on top.

This doc is the engineering reference: architecture, every table, every
cron, every env var. Pair with [docs/NextSteps.md](./NextSteps.md) for the
original product spec.

---

## 1. Architecture

```
                            ┌──────────────────────────────┐
        Real-time webhooks  │                              │
   ┌────────────────────────►       Next.js app on         │
   │                        │       Vercel (Pro)           │
┌──┴──┐  ┌────────────┐     │                              │
│Whop │  │ MailerLite │────►│  /api/webhooks/whop          │
└─┬───┘  └────┬───────┘     │  /api/webhooks/mailerlite    │
  │ ▲        │              │                              │
  │ │ Bulk   │ Bulk          │  /api/cron/* (Vercel Cron)   │
  │ │ sync   │ sync          │  /api/sync/*  (manual)       │
  │ │        ▼              │                              │
  │ └───── /api/sync/whop    │                              │
  └─────── /api/sync/mailerlite                             │
                            │                              │
                            └──────────┬───────────────────┘
                                       │
                                       ▼
                              ┌──────────────────┐
                              │   Supabase       │
                              │   (Postgres)     │
                              │                  │
                              │ • users          │
                              │ • memberships    │
                              │ • payments       │
                              │ • email_events   │
                              │ • activities     │
                              │ • segments       │
                              │ • cadences       │
                              │ • email_templates│
                              │ • template_variables
                              │ • system_runs    │
                              │ • webhook_log    │
                              └──────────────────┘
```

**Data flow:**
1. Whop fires events (memberships, payments) → webhook handler upserts → user re-scored → matching cadences enrolled
2. MailerLite fires events (opens, clicks, bounces) → email_event row + activity row + user re-scored
3. Daily reconcile cron does a full Whop sync as drift correction
4. Hourly orchestrator re-evaluates segments + enrolls segment-triggered cadences
5. Cadence cron (every 15 min) sends due step emails via MailerLite

---

## 2. Data Model

All tables in `public` schema. RLS enabled with `admin_email` policy
(migration 0006). Tables ordered by foreign-key dependency.

### `companies` (migration 0001)
| col | type | note |
|---|---|---|
| `whop_company_id` | TEXT PK | `biz_xxx` from Whop |
| `title` | TEXT | |
| `created_at` | TIMESTAMPTZ | |

### `products` (0001)
| col | type | note |
|---|---|---|
| `id` | UUID PK | |
| `whop_product_id` | TEXT UNIQUE | `prod_xxx` |
| `company_id` | FK companies | |
| `title`, `headline`, `description` | TEXT | |
| `visibility` | TEXT | visible / hidden |
| `route` | TEXT | URL slug |
| `product_group`, `internal_tags[]`, `is_active` | | **operator-set**, not from Whop |

### `plans` (0001)
| col | type | note |
|---|---|---|
| `id` | UUID PK | |
| `whop_plan_id` | TEXT UNIQUE | `plan_xxx` |
| `product_id` | FK products | |
| `title`, `plan_type`, `billing_period_days`, `initial_price`, `renewal_price`, `trial_period_days`, `currency` | | |

### `users` (0002)
| col | type | note |
|---|---|---|
| `id` | UUID PK | |
| `whop_user_id` | TEXT UNIQUE | `user_xxx` |
| `email`, `name`, `username` | | |
| `first_seen_at` | TIMESTAMPTZ | First time we saw them in any product |
| `verification_status`, `verification_raw`, `verification_checked_at`, `verification_suggestion` | | from MailerCheck |
| `mailerlite_subscriber_id`, `mailerlite_groups[]` | | sync state |
| `lifecycle_stage` | TEXT | **derived** by scoring engine |
| `lead_score` | INT | **derived** 0-100 |
| `lead_temperature` | TEXT | **derived** hot/warm/cold/at_risk |
| `total_ltv` | NUMERIC(10,2) | **derived** sum of paid payments |
| `last_engagement_at` | TIMESTAMPTZ | **derived** max(open, click) |
| `internal_notes`, `custom_tags[]` | | operator-set |

Indexes: email, lifecycle_stage, lead_temperature, lead_score DESC

### `memberships` (0002)
One row per Whop membership (a user-product-plan tuple). Time-series — new
rows on plan changes, never deleted.

| col | type | note |
|---|---|---|
| `id` | UUID PK | |
| `whop_membership_id` | TEXT UNIQUE | `mem_xxx` |
| `user_id`, `product_id`, `plan_id` | FK | |
| `status` | TEXT | drafted / trialing / active / past_due / canceled / completed / expired (see §15) |
| `joined_at`, `canceled_at`, `renewal_period_start`, `renewal_period_end` | TIMESTAMPTZ | |
| `cancel_at_period_end` | BOOL | flips when user clicks "cancel" |
| `cancel_option`, `cancellation_reason` | TEXT | free-text from Whop |
| `total_spent_on_membership` | NUMERIC | |
| `promo_code_id` | TEXT | |

### `payments` (0003)
| col | type | note |
|---|---|---|
| `id` | UUID PK | |
| `whop_payment_id` | TEXT UNIQUE | |
| `user_id`, `membership_id`, `product_id`, `plan_id` | FK | |
| `amount`, `currency` | | |
| `status` | TEXT | paid / open / void (Whop's terms — `paid` = succeeded) |
| `substatus` | TEXT | succeeded / failed / refunded / dispute_lost / etc |
| `paid_at`, `refunded_at`, `dispute_alerted_at` | TIMESTAMPTZ | |

### `email_events` (0003)
| col | type | note |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | FK users | |
| `event_type` | TEXT | sent / opened / clicked / bounced / unsubscribed / spam_reported |
| `mailerlite_campaign_id`, `mailerlite_automation_id` | TEXT | |
| `app_campaign_id` | FK campaigns | nullable; tags broadcasts |
| `app_cadence_id` | FK cadences | nullable; tags cadence sends — used by frequency cap to exempt |
| `email_subject`, `clicked_url`, `bounce_reason` | TEXT | |
| `metadata` | JSONB | |
| `occurred_at` | TIMESTAMPTZ | |

### `activities` (0003)
Unified timeline rendered on the user 360 page. Denormalized event log,
written by webhook handlers + scoring engine + cadence sender.

| col | type | note |
|---|---|---|
| `user_id` | FK users | |
| `activity_type` | TEXT | `membership.activated`, `payment.succeeded`, `email.opened`, `cadence.enrolled`, `cadence.email_sent`, `score.changed`, etc. |
| `related_entity_type`, `related_entity_id` | | polymorphic |
| `title`, `description` | TEXT | display |
| `metadata` | JSONB | |
| `occurred_at` | TIMESTAMPTZ | |

### `segments` (0004)
| col | type | note |
|---|---|---|
| `id` | UUID PK | |
| `name`, `description` | | |
| `filter_json` | JSONB | see §8 |
| `is_dynamic` | BOOL | true = re-evaluated on every use |
| `is_starter_template` | BOOL | true = hidden from main list, exposed in /segments/new picker |
| `member_count`, `last_evaluated_at` | | cached |

### `segment_members` (0004)
Cache of segment membership. Refreshed by `evaluateSegment()` (delete-then-insert).
| col | note |
|---|---|
| `(segment_id, user_id)` PK | |
| `added_at` | for "added this week" reports |

### `campaigns` (0004 + 0009)
| col | note |
|---|---|
| `id`, `name`, `subject`, `preview_text` | |
| `mailerlite_campaign_id` | after send |
| `mailerlite_group_id` | per-send sync target |
| `segment_id` | FK to CRM segment used |
| `app_template_id` | FK email_templates |
| `status` | draft / scheduled / sending / sent |
| `total_sent`, `total_delivered`, `total_opened`, `total_clicked`, `total_bounced`, `total_unsubscribed`, `total_complained` | derived aggregates |
| `cap_excluded_count` | INT | how many recipients we skipped due to frequency cap |
| `scheduled_for`, `sent_at`, `created_at` | |

### `cadences` (0004)
| col | note |
|---|---|
| `id`, `name`, `description` | |
| `mailerlite_automation_id` | unused for now |
| `trigger_type` | whop_membership / segment_added / manual |
| `trigger_config` | JSONB — `{plan_ids: [...]}` or `{segment_id: ...}` |
| `sequence_json` | see §9 |
| `status` | draft / active / paused |
| `total_enrolled`, `total_completed` | derived |

### `cadence_enrollments` (0004 + 0013)
| col | note |
|---|---|
| `(cadence_id, user_id)` UNIQUE | idempotent on webhook retry |
| `current_step` | INT, next step to send |
| `last_sent_step` | INT, idempotency vs concurrent runs |
| `status` | active / completed / exited |
| `enrolled_at`, `next_action_at`, `completed_at` | |
| `exit_reason` | TEXT |
| `last_send_at`, `last_send_error` | |

Index: partial on `(next_action_at)` WHERE active.

### `email_templates` (0010)
| col | note |
|---|---|
| `id`, `name`, `description`, `html` | |
| `labels[]` | TEXT[] free-form tags, GIN indexed |
| `suggested_subject`, `preview_text` | optional defaults |

### `template_variables` (0012)
| col | note |
|---|---|
| `key` UNIQUE | uppercase + underscore, CHECK enforced |
| `value`, `description` | |

Seeded with `WHOP_FREE_URL`, `WHOP_TRIAL_URL`, `WHOP_BUILDROOM_URL`, `WHOP_COHORT_URL`, `WHOP_1TO1_WAITLIST_URL`, `SENDER_NAME`.

### `frequency_caps` (0005)
Single active row drives the cap. Default seeded `(window_days=7, max_emails=2)`.

### `scoring_config` (0005)
Documentation table — actual weights live hardcoded in `lib/scoring/weights.ts`.

### `webhook_log` (0005)
Dedupe + audit. UNIQUE on `(source, event_id)` so retries are no-ops.

### `system_runs` (0014)
One row per cron invocation. Powers `/admin/health`.
| col | note |
|---|---|
| `job` | rescore / cadences / orchestrator / daily-reconcile |
| `started_at`, `finished_at`, `duration_ms` | |
| `status` | ok / partial / failed |
| `summary` | JSONB |
| `error` | nullable |

### Views
- **`segment_eligibility_view`** (0007): one row per user with all derivable fields. The single source of truth for segment filtering. Adding a column here without whitelisting in `lib/segments/schema.ts` does nothing — fields are runtime-validated.
- **`user_marketing_view`**: similar but for the users list page.
- **`payments_daily_view`**, **`signups_daily_view`**, **`product_revenue_aggregates_view`**: dashboard aggregates.

---

## 3. Integrations

### Whop
- **API base**: `https://api.whop.com/api/v1`
- **SDK**: `@whop/sdk` (read by `lib/whop/client.ts`)
- **Auth**: Bearer with `WHOP_API_KEY` (the company key, prefix `apik_`)
- **Webhook signing**: NOT standardwebhooks despite their docs claim. Custom HMAC with secret-as-UTF-8-bytes. `lib/whop/verify-webhook.ts` tries 4 derivations and uses the one that matches (`utf8(full)` confirmed working). DO NOT replace with `@whop/sdk`'s `unwrap()` — it always fails.

### MailerLite
- **API base**: `https://connect.mailerlite.com/api`
- **Client**: `lib/mailerlite/client.ts`
- **Auth**: Bearer with `MAILERLITE_API_KEY` (988-char JWT). Defensive scrub against env-var paste contamination — strips quotes, takes only the first whitespace-separated token.
- **Webhook signing**: HMAC-SHA256 hex of body. Verified in `lib/mailerlite/webhook.ts`.
- **Per-user send pattern**: each user has a dedicated `crm-user-<userId>` group. Cadence sends import the user, target the group, schedule instant. Group persists, re-imports are no-ops.

### MailerCheck
- **Client**: `lib/mailercheck/client.ts`
- **Auth**: Bearer with `MAILERCHECK_API_KEY`
- **Used for**: verifying email addresses before sending. Updates `users.verification_status`.

### Supabase
- Service-role client via `lib/supabase/admin.ts` for server-side writes (bypasses RLS).
- Browser/SSR clients via `lib/supabase/client.ts` and `server.ts` for auth flows.
- Auth: email + password (was magic-link until Apr 28). `app/auth/actions.ts` handles signin + applies `ALLOWED_EMAILS` allow-list.

---

## 4. Real-time pipelines

### `/api/webhooks/whop`
Verifies signature → dedupes via `webhook_log` → dispatches:
- `membership.*` → `upsertMembership` → `applyScoreSafe` → if `membership.activated`, find cadences with matching `trigger_config.plan_ids` and `enrollUserInCadence` for each
- `payment.*` / `refund.succeeded` / `dispute.*` → `upsertPayment` → `applyScoreSafe`

### `/api/webhooks/mailerlite`
Verifies signature → dedupes → for each event:
- Look up user by email
- Insert `email_event` row (with `mailerlite_campaign_id` etc)
- Write `activity` row
- Re-score user

---

## 5. Scheduled cron jobs (Vercel Pro)

All wrapped through `lib/orchestrator/run-once.ts → runJob()` so each invocation
inserts a `system_runs` row.

| Job | Schedule | Code | What |
|---|---|---|---|
| `cadences` | `*/15 * * * *` | `/api/cron/cadences` → `runDueCadenceSteps` | Picks active enrollments where `next_action_at ≤ NOW()`, sends current step's template, advances state, completes at last step |
| `orchestrator` | `23 * * * *` | `/api/cron/orchestrator` → `runHourlyOrchestrator` | Re-evaluates every dynamic non-template segment; for each `trigger_type=segment_added` cadence, enrolls all current members not yet enrolled |
| `rescore` | `17 8 * * *` | `/api/cron/rescore` → `rescoreAllUsers` | Time-decay rescoring for every user (idempotent) |
| `daily-reconcile` | `47 4 * * *` | `/api/cron/daily-reconcile` → `runDailyReconcile` | Whop catalog + memberships + payments full sync (~5 min for 25k memberships, 9k payments) |

All cron routes accept either:
- `Authorization: Bearer ${CRON_SECRET}` (Vercel cron)
- `x-sync-secret: ${SYNC_SECRET}` POST (manual / ops)

`maxDuration` set to 300s on most, 800s on daily-reconcile.

---

## 6. Lead scoring

`lib/scoring/{weights,compute,fetch,apply,rescore}.ts`

### Signals → points (from `weights.ts`)
| Signal | Points |
|---|---|
| has_active_paid_membership | +20 |
| purchased_last_30_days | +15 |
| opened_email_last_7_days | +10 |
| clicked_email_last_14_days | +10 |
| on_multiple_products (≥2 active) | +5 |
| ltv_over_500 | +15 |
| positive_engagement_trend (more opens this month than last) | +10 |
| cancel_at_period_end | -20 |
| no_engagement_30_days | -15 |
| bounced_or_complained | -10 |
| failed_payment_90_days (per failure) | -5 |

Score clamped 0..100.

### Temperature buckets
80+ hot · 50-79 warm · 20-49 cold · 0-19 at_risk

### Lifecycle derivation
`hasActiveMembership` → active. `hasEverHadMembership` → churned. else prospect.

### Triggers for re-score
- Inline on every Whop + MailerLite webhook event (real-time)
- Nightly `rescore` cron for time-decay catches

### Persistence
`apply.ts` writes back: `lead_score`, `lead_temperature`, `lifecycle_stage`,
`total_ltv`, `last_engagement_at`. Logs `score.changed` activity only on
bucket crossings (not every score delta).

---

## 7. Segments

### Filter JSON shape (`lib/segments/schema.ts`)
```json
{
  "match": "all" | "any",
  "rules": [
    {"field": "lead_score", "op": "gte", "value": 80},
    {"field": "active_products", "op": "contains", "value": "Build Room"}
  ]
}
```

### Whitelisted fields
Defined in `FIELDS` array. Adding a column to `segment_eligibility_view` ≠
making it filterable; must also add to this whitelist with allowed ops.

Currently filterable: `email`, `lifecycle_stage`, `verification_status`,
`lead_temperature`, `lead_score`, `total_ltv`, `opens_30d`, `clicks_30d`,
`first_seen_at`, `last_purchased_at`, `last_engagement_at`, `last_open_at`,
`last_click_at`, `active_products`, `ever_products`, `custom_tags`.

### Operators
- enum: eq, neq, in, not_in
- number: gte, lte, gt, lt, eq, neq
- text: contains, not_contains, eq, neq
- timestamp: lt_days_ago, gt_days_ago, is_null, is_not_null
- tags: tag_includes, tag_not_includes

### Evaluation
`lib/segments/evaluate.ts` translates the JSON into a Supabase query against
`segment_eligibility_view`, paginates 1000 rows at a time, populates
`segment_members`. Runs hourly via the orchestrator.

---

## 8. Cadences

### Sequence JSON (`lib/cadences/types.ts`)
```json
{
  "version": 1,
  "steps": [
    {
      "type": "send_email",
      "template_id": "<uuid>",
      "delay_hours": 0,
      "require_segment_id": "<uuid>",
      "exit_if": {
        "match": "all",
        "rules": [{"field": "any_cancel_at_period_end", "op": "is_false"}],
        "reason": "un-cancelled"
      }
    },
    {"type": "send_email", "template_id": "<uuid>", "delay_hours": 24}
  ]
}
```
v1 only supports `send_email`. `delay_hours` is from-prior-step; step 0's
delay is from enrollment. `require_segment_id` (optional) skips the step
if the user is no longer in that segment at send time. `exit_if` (optional)
exits the entire enrollment if the rule matches — see "Exit conditions"
below.

### Trigger types
- `whop_membership` — `trigger_config.plan_ids: [...]`. Empty = any plan.
  Fired by webhook on `membership.activated`.
- `whop_event` — `trigger_config.event_types: [...]` (required, ≥1) plus
  optional `plan_ids`, `payload_path`, `payload_value`. Fires on any
  Whop webhook event matching the configured types. The payload predicate
  filters on a single JSON path — e.g. `payload_path="cancel_at_period_end"`
  + `payload_value=true` fires only when the user *actually* clicks cancel,
  not when they un-cancel. Powers save-flow, past-due rescue, dispute
  follow-up, etc.
- `segment_added` — `trigger_config.segment_id: <uuid>`. Fired hourly by
  orchestrator for each user newly in the segment.
- `manual` — only via UI on `/cadences/[id]`.

### Exit conditions (`exit_if`)
Optional per-step filter evaluated against the user's CURRENT state
(re-read at runtime, not enrollment time). If it matches, the runner
short-circuits the enrollment with a recorded reason — no further sends.

**Field set** (`lib/cadences/exit-conditions.ts`):
- `lifecycle_stage`, `lead_temperature`, `total_ltv` — from `users` table
- `any_active_membership`, `any_cancel_at_period_end`,
  `any_past_due_membership` — derived from `memberships` rows

**Operators**: `eq`, `neq`, `gt`, `lt`, `gte`, `lte`, `is_true`, `is_false`

**Match modes**: `all` (default — every rule must match) or `any` (at least
one). Up to 10 rules per condition.

Use cases: stop the cancel-save cadence the moment they un-cancel, stop
past-due rescue when their card works, stop win-back when they re-purchase.

### Send mechanics (`lib/cadences/send.ts`)
1. Resolve `{{KEY}}` variables from `template_variables`
2. `findOrCreateGroup("crm-user-<userId>")` — dedicated single-user group
3. `upsertSubscriberToGroup(email, groupId)` — sub-second sync API
4. `createCampaign({ name, emails: [...], groups: [groupId] })`
5. `scheduleCampaign(id, { delivery: "instant" })`
6. Insert `email_event` tagged with `app_cadence_id` (frequency-cap exempt)
7. Write `cadence.email_sent` activity

### Idempotency
- Enrollment unique on `(cadence_id, user_id)` — webhook retries safe
- `last_sent_step >= current_step` guard prevents double-send when two cron
  invocations overlap

### Live cadences

| Cadence | Trigger | Scope | Status |
|---|---|---|---|
| `Free signup · 10-day welcome` | `whop_membership` | plan `plan_yRLG1PNR7m8Yh` (free AutomationFlow) only | active — 10 templates, Day 1 instant + Days 2–10 every 24h |
| `Cancel-save · 3-touch` | `whop_event` on `membership.cancel_at_period_end_changed` (`payload_value=true`) | company-wide | active — 3 templates: Day 0 / Day 2 / Day 5. Each step `exit_if` `any_cancel_at_period_end is_false` (un-cancel exits the flow) |
| `Past-due rescue · payment recovery` | `whop_event` on `payment.failed` | company-wide | **draft** — placeholder templates from migration 0015. 3 steps: Day 1 / Day 3 / Day 7. Each step `exit_if` `any_past_due_membership is_false` |
| `Win-back · 60-day re-engagement` | `segment_added` | placeholder `segment_id` (operator wires before activating) | **draft** — placeholder templates from migration 0015. 3 steps: Day 0 / Day 7 / Day 14. Each step `exit_if` `lifecycle_stage neq churned` |

The two `draft` cadences need their templates populated (see `/templates`,
filter by label `lifecycle`) and — for win-back — `trigger_config.segment_id`
wired to a real segment before the operator flips status to `active`.

---

## 9. Templates + Variables

### Templates (`/templates`)
- HTML body + `name`, `description`, `labels[]`, `suggested_subject`, `preview_text`
- Editor: split-pane source/preview with live updates, debounced 200ms
- Find/Replace bar (Cmd-F)
- Auto-detected `[bracketed]` placeholder chips
- Live `{{KEY}}` variable substitution in preview
- `app_template_id` on campaigns table tracks which template seeded a send

### Variables (`/variables`)
`{{UPPER_SNAKE_CASE}}` syntax. Substituted:
- Live in template editor preview
- Server-side at campaign send time
- Server-side at cadence send time

`lib/templates/variables.ts` provides:
- `substituteVariables(html, vars)` — replace
- `extractTokens(html)` — distinct refs in order
- `findMissingTokens(html, vars)` — refs without definitions

MailerLite-native tokens like `{$unsubscribe}` and `[Name]` are NOT touched
by our regex — they pass through untouched for MailerLite to handle.

### 10 Build Room templates (migration 0011)
Day 1-10. Paper / graphite / signal-orange design, Inter Tight + Inter +
JetBrains Mono. Tags: `build-room`, `welcome-series`, `day-NN`, plus
theme tag (`pitch`, `technical`, `validation`, etc).

---

## 10. Frequency capping

`lib/frequency/check.ts`

- `getActiveCap(db)` — reads the active row of `frequency_caps`
- `findCappedEmails(db, emails, rule)` — given a candidate list, returns
  the subset who'd exceed the cap if they got one more send

Counts only **broadcast** sends (`email_events.app_cadence_id IS NULL`).
Cadence sends are exempt AND don't count toward the cap budget.

Applied at campaign creation (CRM-segment path only — raw MailerLite
audiences aren't filterable). Persists `cap_excluded_count` on the
campaign row; `/campaigns/[id]` shows a banner.

---

## 11. Auth + access control

### Login flow
- `/auth/login` → server action `signInWithPasswordAction` in `app/auth/actions.ts`
- Calls `supabase.auth.signInWithPassword`
- Applies `ALLOWED_EMAILS` allow-list (comma-separated env var)
- Redirects to `?next=` path on success

### Middleware (`proxy.ts`)
**Next.js 16 renamed `middleware.ts` → `proxy.ts`**. Don't accidentally rename it back.

Public paths (no auth required):
- `/auth/*`
- `/api/webhooks/*` (HMAC-signed)
- `/api/sync/*` (x-sync-secret)
- `/api/cron/*` (Bearer CRON_SECRET)
- `/_next/*`, `/favicon.ico`

`DISABLE_AUTH=true` env var bypasses middleware — used locally only.

### User accounts
Live Supabase auth users:
- `kevin@brnk.studio` — password `Eagles`
- `cosgravek@outlook.com` — password `Eagles`

### Allow-list
`ALLOWED_EMAILS` env var. Comma-separated. Empty list = no gating (any
Supabase auth user can sign in). Currently:
`conkosleymedia@gmail.com,cosgravek@outlook.com,kevin@brnk.studio`

---

## 12. Operational

### Required env vars (Vercel + `.env.local`)
| Var | Source | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project settings | |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | | |
| `SUPABASE_SERVICE_ROLE_KEY` | | server-side admin client |
| `WHOP_API_KEY` | Whop → API keys (company key) | `apik_...` 92 chars |
| `WHOP_COMPANY_ID` | Whop company URL | `biz_...` |
| `WHOP_WEBHOOK_SECRET` | Whop → Webhooks → signing secret | `ws_<64 hex>` |
| `WHOP_APP_API_KEY` | optional fallback | |
| `NEXT_PUBLIC_WHOP_APP_ID` | optional | |
| `MAILERLITE_API_KEY` | MailerLite → API → token | 988-char JWT |
| `MAILERLITE_WEBHOOK_SECRET` | MailerLite → webhook config | |
| `MAILERCHECK_API_KEY` | MailerCheck account | |
| `SYNC_SECRET` | Generate: `openssl rand -hex 32` | manual sync auth |
| `CRON_SECRET` | Generate: `openssl rand -hex 32` | Vercel cron auth |
| `ALLOWED_EMAILS` | operator | login allow-list (comma-separated) |
| `DISABLE_AUTH` | optional | "true" to bypass auth (local only) |
| `NEXT_PUBLIC_APP_URL` | the deployment URL | for absolute URLs |

### Webhook URLs to register
- Whop dashboard → Developer → Webhooks → URL = `https://<domain>/api/webhooks/whop`. Subscribe: `membership.activated`, `membership.deactivated`, `membership.cancel_at_period_end_changed`, `payment.succeeded`, `payment.failed`, `refund.succeeded`, `dispute.*`
- MailerLite dashboard → Integrations → Webhooks → URL = `https://<domain>/api/webhooks/mailerlite`. Subscribe: `campaign.sent`, `campaign.open`, `campaign.click`, `subscriber.bounced`, `subscriber.unsubscribed`, `subscriber.spam_reported`

### Deploy
- GitHub repo: `ConcosleyMedia/Whop-Marketing` (note typo in org name)
- Vercel project: `whop-marketing`, team `kevin-2569's projects`
- Auto-deploy from `main` (the GitHub integration was broken once and required reconnection — see git log Apr 28)
- Manual deploy: `vercel --prod --yes` from the repo with `vercel link` already done

### Observability
`/admin/health` — single page showing:
- Last run + status of each cron
- Health badge per job (ok / stale / missing)
- Recent failures tail (last 7 days)
- Live counts: active cadences, in-flight enrollments, completed, segments

### Manual ops endpoints
| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/sync/whop` | x-sync-secret | full Whop catalog sync |
| `POST /api/sync/whop/memberships` | x-sync-secret | full memberships sync |
| `POST /api/sync/whop/payments` | x-sync-secret | full payments sync |
| `POST /api/sync/mailerlite` | x-sync-secret | MailerLite groups/fields/subscribers sync |
| `POST /api/sync/mailercheck` | x-sync-secret | run verification batch |
| `POST /api/sync/rescore?limit=N` | x-sync-secret | manual lead-score backfill |
| `POST /api/cron/cadences` | x-sync-secret | force-fire cadence runner |
| `POST /api/cron/orchestrator` | x-sync-secret | force-fire orchestrator |
| `POST /api/cron/daily-reconcile` | x-sync-secret | force-fire daily reconcile |

---

## 13. File index

```
app/
  page.tsx                       # Whoop-style dark home dashboard
  layout.tsx                     # Nav + global font wrappers
  proxy.ts                       # Next.js 16 middleware (auth gating)
  admin/health/page.tsx          # Cron health page
  api/
    cron/{cadences,orchestrator,rescore,daily-reconcile}/route.ts
    sync/{whop,mailerlite,mailercheck,rescore}/route.ts
    webhooks/{whop,mailerlite}/route.ts
  auth/
    actions.ts                   # signInWithPasswordAction
    login/{page,login-form}.tsx
    callback/route.ts            # legacy magic-link callback
    logout/route.ts
  cadences/
    page.tsx, [id]/page.tsx, actions.ts
  campaigns/
    page.tsx, [id]/page.tsx, new/{page,template-picker}.tsx, actions.ts
  groups/[id]/page.tsx           # MailerLite group detail
  segments/
    page.tsx, [id]/page.tsx, new/{page,segment-builder}.tsx
    mailerlite/[id]/page.tsx, mailerlite/page.tsx
  templates/
    page.tsx, [id]/page.tsx, new/page.tsx
    template-editor.tsx, send-test-form.tsx, actions.ts
  users/
    page.tsx, [id]/page.tsx
  variables/
    page.tsx, actions.ts

lib/
  cadences/{types,enroll,send,run}.ts
  format.ts                      # toDate, formatMoney, formatRelative — UTC-safe
  frequency/check.ts
  mailercheck/{client,backfill}.ts
  mailerlite/{client,sync,sync-segment,webhook}.ts
  orchestrator/{run-once,hourly,daily}.ts
  scoring/{weights,compute,fetch,apply,rescore}.ts
  segments/{schema,evaluate}.ts
  supabase/{admin,client,server,middleware}.ts
  templates/variables.ts
  whop/{client,sync,upsert,verify-webhook}.ts
  sync-auth.ts

components/
  nav.tsx
  activity-timeline.tsx
  dashboard-charts.tsx           # Whoop-palette Recharts
  ui/*                           # shadcn primitives

supabase/migrations/
  0001_core_entities.sql         # companies, products, plans
  0002_users_memberships.sql
  0003_payments_activities.sql
  0004_segments_campaigns_cadences.sql
  0005_scoring_caps_webhooks.sql
  0006_rls.sql
  0007_segment_eligibility_view.sql
  0008_seed_segment_templates.sql
  0009_campaign_cap_excluded.sql
  0010_email_templates.sql
  0011_seed_build_room_emails.sql
  0012_template_variables.sql
  0013_cadence_runtime.sql
  0014_system_runs.sql
  0015_seed_lifecycle_cadences.sql  # past-due + winback placeholders, dup cancel-save (cleaned up by 0016)
  0016_cleanup_cancel_save_duplicate.sql

vercel.json                      # 4 cron schedules
```

---

## 14. Known quirks + gotchas

1. **Whop webhook signing isn't standardwebhooks** despite docs. The custom verifier in `lib/whop/verify-webhook.ts` uses `utf8(full)` derivation. If Whop ever fixes their docs and migrates to actual standardwebhooks, the verifier will need adjusting.
2. **`ws_` prefix on Whop secret is part of the HMAC key**, not a header. Don't strip it.
3. **MailerLite API key has been pasted dirty multiple times.** Client defensively trims and splits on whitespace. Canonical value should be the bare 988-char JWT.
4. **Vercel Hobby caps cron to daily**. Project is on Pro now (Apr 28). If you ever downgrade, edit `vercel.json` to daily schedules + reduce `maxDuration` to 300s.
5. **Whop dashboard sometimes shows membership statuses** like `drafted` (abandoned checkout) and `completed` (term ran out cleanly). Different from `canceled`. See migration 0002 column comments.
6. **MailerLite flips campaign.status to "sent" on schedule acceptance**, not on actual delivery. `finished_at` is the only honest "did it really send" signal. `app/campaigns/page.tsx` derives "sending" vs "sent" using this.
7. **Per-user MailerLite groups** (`crm-user-<uuid>`) accumulate over time. Cleanup is on the future-work list.
8. **`segment_eligibility_view` is the single source of truth** for filterable user attributes. Always add new fields here, then whitelist in `lib/segments/schema.ts`.

---

## 15. Whop membership statuses

| Status | Meaning |
|---|---|
| `drafted` | Checkout started, never completed. No money changed hands. |
| `trialing` | In a free trial period |
| `active` | Currently has access, paying on a recurring cycle |
| `past_due` | Recurring payment failed but still in grace period |
| `canceled` | User explicitly cancelled. May still have access until period ends. |
| `expired` | Term ended, access revoked |
| `completed` | Membership finished cleanly — fixed-duration product reached its end, or one-time purchase delivered. **Different from canceled** |

A single user can have multiple membership rows for the same product (e.g.,
2 × `drafted`, 1 × `completed`, 2 × `active`) reflecting their full history.

---

## 16. Where automation logic lives

### Cadences (declarative)
- Definition: `cadences.sequence_json` + `trigger_config`
- Runtime: `lib/cadences/run.ts` (worker) + webhook handlers (real-time enroll) + orchestrator (segment-based enroll)

### Lead scoring (deterministic)
- Hardcoded weights: `lib/scoring/weights.ts`
- Pure compute: `lib/scoring/compute.ts`
- Triggers: every webhook event + nightly cron

### Segments (declarative)
- Filter JSON in DB: `segments.filter_json`
- Evaluator: `lib/segments/evaluate.ts`

### Frequency cap (declarative)
- Single rule row: `frequency_caps`
- Enforcer: `lib/frequency/check.ts` (called from campaign create flow)

---

## 17. Build a new automation: cookbook

### Scenario: "When member's payment fails, send save-flow email"

A `Past-due rescue · payment recovery` cadence already ships as a draft
(seeded by migration 0015). To go live:

1. **Populate templates.** `/templates` filtered by labels `past-due` +
   `lifecycle` shows the 3 placeholder bodies (Day 1 / Day 3 / Day 7).
   Replace the placeholder HTML with real copy — include the update-card
   link and `{{WHOP_BUILDROOM_URL}}` / `{{SENDER_NAME}}` variables.
2. **Activate.** `/cadences/[id]` for the past-due cadence → flip status
   `draft → active`. Webhook handler already routes `payment.failed`
   events to `findCadencesForWhopEvent()` (see
   `app/api/webhooks/whop/route.ts`).
3. **Done.** Each step `exit_if` automatically bails out when the user no
   longer has a `past_due` membership — no manual intervention needed
   when the card recovers.

To author a *new* `whop_event` cadence from scratch, insert into `cadences`:
- `trigger_type='whop_event'`
- `trigger_config={'event_types': ['<event.type>'], 'plan_ids': [], 'payload_path': '...', 'payload_value': ...}`
- `sequence_json` per the v1 schema in §8 (use `exit_if` on each step
  if the cadence should self-cancel)

### Scenario: "Win-back members who churned 60+ days ago"

A `Win-back · 60-day re-engagement` cadence ships as a draft (seeded by
migration 0015) — it just needs the segment wired:

1. **Create segment** at `/segments/new`:
   - `lifecycle_stage = churned`
   - `last_purchased_at gt_days_ago 60`
   - `last_purchased_at lt_days_ago 365` (avoid ancient ones)
2. **Wire it to the cadence.**
   `UPDATE cadences SET trigger_config = jsonb_set(trigger_config, '{segment_id}', '"<uuid>"'::jsonb) WHERE id = '22222222-2222-2222-2222-e00000000001';`
3. **Populate templates.** `/templates` filtered by `winback` shows the 3
   placeholder bodies (Day 0 / Day 7 / Day 14).
4. **Activate.** Hourly orchestrator auto-enrolls newly-matching users.
   Each step `exit_if` automatically bails when `lifecycle_stage` leaves
   `churned` (i.e. the user re-purchased).

---

## 18. Missing primitives (recommended next builds)

### Recently shipped

- ✅ **`whop_event` trigger type** — shipped in [3e4c1bb](https://github.com/ConcosleyMedia/Whop-Marketing/commit/3e4c1bb). See §8.
- ✅ **Per-step exit conditions (`exit_if`)** — shipped in [3e4c1bb](https://github.com/ConcosleyMedia/Whop-Marketing/commit/3e4c1bb). See §8.
- ✅ **Past-due rescue + win-back cadence seeds** — shipped as drafts in
  [1efe08f](https://github.com/ConcosleyMedia/Whop-Marketing/commit/1efe08f); cancel-save dedup in [b548f68](https://github.com/ConcosleyMedia/Whop-Marketing/commit/b548f68).

### Still missing (priority order)

1. **Segment-exit triggers** — symmetric with `segment_added`. "When user leaves segment X, enroll in cadence Y." Or "exit cadence Y when leaves segment X." (`exit_if` partially covers the second use case but is per-step, not segment-aware.)
2. **Step branching** — `next_if(condition) → step_a, else → step_b`. Supports email A/B paths.
3. **Action types beyond email** — tag user, update field, fire external webhook, post to Slack.
4. **LLM step type** — for content personalization (not for routing decisions).
5. **Cadence builder UI** — `/cadences/new` page with trigger picker + per-step editor exposing `exit_if`. Currently authoring is SQL-migration-only; fine while there are <10 cadences but a tax on iteration speed beyond that.
6. **Per-user MailerLite group cleanup** — purge `crm-user-*` groups for users who completed every cadence > 30 days ago.
