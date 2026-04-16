# CRM + Email Management App — Build Spec

## What this is

A purpose-built CRM and email marketing platform for your Whop business. Think HubSpot Marketing Hub or Salesforce + Pardot, but narrowly scoped to your ecosystem: **Whop is the system of record for commerce, MailerLite is the send engine, MailerCheck is the verifier, and this app is the brain on top of all of them.**

You log into this app to do everything:
- See who your members are and what they've bought (across all products, lifetime)
- Build reports and segments ("new subscribers this month on Product X who opened the last campaign")
- Send campaigns to those segments via MailerLite
- See engagement come back (opens, clicks, bounces) tied to each member
- Score members automatically (hot / warm / cold / at-risk)
- Build automated cadences that run based on behavior + lifecycle events

## The data flow

```
Whop ──────────►  App DB (source of truth for CRM)  ──────────► MailerLite
 │                 │                                              │
 │                 ├─► MailerCheck (verify before send)           │
 │                 │                                              │
 └──(webhooks)─────┘◄─────────────(webhooks: opens/clicks)────────┘
```

Whop writes to the app. MailerLite writes back to the app. The app is always the single pane of glass.

---

## The data model (the critical part — get this right once)

This is a proper relational model. The temptation is to flatten everything into one `members` table like a spreadsheet. Resist it. The reporting functionality you want requires normalized entities with real relationships.

### Core entities

**`companies`** — your Whop company(ies). Usually one row.
| Field | Notes |
|---|---|
| `whop_company_id` | PK from Whop (`biz_xxx`) |
| `title` | e.g. "Acme Trading" |
| `created_at` | |

**`products`** — your Whop products (6-20 of them). One row per product.
| Field | Notes |
|---|---|
| `whop_product_id` | PK from Whop (`prod_xxx`) |
| `company_id` | FK |
| `title` | "Pro Trading Room", "Signals Daily", etc. |
| `headline`, `description` | From Whop |
| `visibility` | visible / hidden |
| `business_type`, `industry_type` | From Whop |
| `route` | URL slug |
| `product_group` | **Your own** field — for categorizing (e.g. "Trading", "Coaching", "Courses") |
| `internal_tags` | **Your own** field — array of tags you define |
| `is_active` | **Your own** field — whether you still sell it |

*The `product_group` and `internal_tags` are yours to define — Whop doesn't have these. This is what makes the catalog navigable in a 20-product world. Example: filter all campaigns to "only Trading products" or "only high-ticket products."*

**`plans`** — pricing variants of each product (monthly, yearly, $1 trial, etc.).
| Field | Notes |
|---|---|
| `whop_plan_id` | PK from Whop (`plan_xxx`) |
| `product_id` | FK |
| `title` | "Monthly", "Annual", "7-Day Trial" |
| `plan_type` | renewal / one_time |
| `billing_period_days` | |
| `initial_price`, `renewal_price` | |
| `trial_period_days` | |
| `currency` | |

**`users`** — unique human beings. One row per person, regardless of how many products they've bought.
| Field | Notes |
|---|---|
| `whop_user_id` | PK from Whop (`user_xxx`) |
| `email` | |
| `name`, `username` | |
| `first_seen_at` | When they first showed up on any product |
| `verification_status` | From MailerCheck |
| `verification_checked_at` | |
| `mailerlite_subscriber_id` | After first sync |
| `lifecycle_stage` | **Derived**: prospect / trial / active / churned / winback |
| `lead_score` | **Derived**: 0-100 |
| `lead_temperature` | **Derived**: hot / warm / cold / at-risk |
| `total_ltv` | **Derived**: sum of `usd_total_spent` across all memberships |
| `last_engagement_at` | **Derived**: most recent open/click |

**`memberships`** — the relationship between a user and a product, over time. **One row per membership transition.** This is the key table for your "full lifecycle" requirement.
| Field | Notes |
|---|---|
| `whop_membership_id` | PK from Whop (`mem_xxx`) |
| `user_id` | FK |
| `product_id` | FK |
| `plan_id` | FK |
| `status` | trialing / active / past_due / canceled / expired / completed |
| `created_at` | When they first signed up |
| `joined_at` | When access started |
| `canceled_at` | Null unless canceled |
| `renewal_period_start`, `renewal_period_end` | Current billing window |
| `cancel_at_period_end` | Boolean |
| `cancel_option`, `cancellation_reason` | Why they left |
| `total_spent_on_this_membership` | Lifetime revenue from this one sub |
| `promo_code_id` | FK to promo codes if used |

*Because memberships are time-series rows (not a single "current state" row), you can answer questions like "who upgraded from the $9/mo plan to the $49/mo plan in Q2?" — which is exactly the cross-sell reporting you asked for.*

**`payments`** — every charge, ever. One row per payment event.
| Field | Notes |
|---|---|
| `whop_payment_id` | PK |
| `user_id`, `membership_id`, `product_id`, `plan_id` | FKs |
| `amount`, `currency` | |
| `status` | succeeded / failed / refunded / disputed |
| `paid_at` | |
| `refunded_at` | If refunded |
| `dispute_alerted_at` | If chargeback |

**`email_events`** — every open, click, bounce, unsubscribe. From MailerLite webhooks.
| Field | Notes |
|---|---|
| `user_id` | FK |
| `event_type` | sent / delivered / opened / clicked / bounced / unsubscribed / complained |
| `campaign_id` or `automation_id` | Which send |
| `email_subject` | |
| `clicked_url` | For click events |
| `occurred_at` | |

**`activities`** — unified timeline of everything that ever happened to a user. This powers the "full activity timeline" view on each user's profile.
| Field | Notes |
|---|---|
| `user_id` | FK |
| `activity_type` | enum: membership_started, membership_canceled, upgraded, downgraded, payment_succeeded, payment_failed, email_sent, email_opened, email_clicked, verification_updated, score_changed, etc. |
| `related_entity_id` | Polymorphic — FK to whichever entity |
| `metadata` | JSON for details |
| `occurred_at` | |

*This table is denormalized by design — it's a read-optimized event log for display. Written to by triggers/workers whenever anything else changes.*

**`campaigns`** — campaigns you send (manual broadcasts, not automations).
| Field | Notes |
|---|---|
| `id` | |
| `mailerlite_campaign_id` | After send |
| `name` | Internal name |
| `segment_id` | FK to the segment used |
| `subject`, `preview_text` | |
| `mailerlite_template_id` | |
| `sent_at` | |
| `status` | draft / scheduled / sending / sent |
| `total_sent`, `total_opened`, `total_clicked`, `total_bounced` | **Derived** aggregates |

**`cadences`** — multi-step automations (what I described in the previous spec).
Similar to campaigns but with a sequence of steps and a trigger.

**`segments`** — saved filters. This is the "reporting" core.
| Field | Notes |
|---|---|
| `id` | |
| `name` | "New subscribers this month", "At-risk churners", "Trading customers who haven't opened in 30 days" |
| `filter_json` | Structured filter definition (see below) |
| `is_dynamic` | If true, re-evaluated on every use. If false, frozen list of user IDs at creation time. |
| `member_count` | **Cached**, refreshed on load |
| `last_evaluated_at` | |

**`segment_members`** — cache of which users are in which (dynamic) segment.
| Field | Notes |
|---|---|
| `segment_id`, `user_id` | Composite PK |
| `added_at` | For "added this week" reports |

---

## The reporting engine (the Salesforce-like part)

### Filter primitives

A segment is a JSON tree of conditions. Every condition matches against a user based on their related entities. Example filter for "new subscribers this month on Product X":

```json
{
  "match": "all",
  "conditions": [
    { "field": "memberships.product_id", "op": "equals", "value": "prod_xxx" },
    { "field": "memberships.status", "op": "equals", "value": "active" },
    { "field": "memberships.joined_at", "op": "after", "value": "2026-04-01" },
    { "field": "users.verification_status", "op": "equals", "value": "sendable" }
  ]
}
```

### Filterable fields (minimum for v1)

**User-level:**
- Email, name, username
- Lifecycle stage, lead score, lead temperature
- Total LTV (number range)
- First seen date, last engagement date
- Verification status
- MailerLite groups (current membership)

**Membership-level (any or all):**
- Product ID (multi-select from your catalog)
- Product group / tag
- Plan ID
- Status
- Joined date, canceled date (ranges)
- Cancellation reason
- Currently has access (boolean: does user have at least one active membership to this product?)
- Ever had access (boolean: does user have any historical membership to this product?)

**Payment-level:**
- Total spend (range)
- Last payment date
- Has had refund / dispute

**Engagement-level:**
- Last opened email (date range)
- Last clicked email (date range)
- Opened in last N days
- Never opened
- Received specific campaign (by ID)
- Clicked specific URL

### Pre-built report templates

Ship these as starter segments on day 1 so you can use the app immediately:

1. **New subscribers this month** — any active membership joined in current month
2. **New subscribers this month by product** — 1 report per product
3. **At-risk churn** — active but `cancel_at_period_end = true`, OR low engagement + 30+ days until renewal
4. **Failed payment recovery** — memberships with `past_due` status
5. **Trial ending in 3 days** — memberships where trial ends within 72 hours
6. **Churned last 30 days** — canceled or expired in the last month
7. **Top spenders** — users with LTV > threshold
8. **Engaged but not converted** — opened 3+ emails in last 14 days, no active paid membership
9. **Cross-sell candidates** — active on Product A, never bought Product B (pick A/B)
10. **Reactivation targets** — churned 60-180 days ago, still in sendable state

### Report UI

- List of all saved segments (your custom ones + starters) with live counts
- Click a segment → see the full filtered table with columns you can customize
- Every table is exportable to CSV
- "Send to MailerLite" button on any segment → creates/updates a MailerLite group with exactly those users, then opens the campaign builder with that group pre-selected

---

## Lead scoring (the hot/warm/cold part)

### The scoring model

Score each user 0-100. Refresh on every relevant activity.

**Positive signals (add points):**
- +20 if any active paid membership
- +15 if purchased in last 30 days
- +10 if opened an email in last 7 days
- +10 if clicked a link in last 14 days
- +5 if on multiple products simultaneously
- +15 if total LTV > $500
- +10 if recent engagement trajectory is positive (more opens this month than last)

**Negative signals (subtract points):**
- -20 if cancel_at_period_end = true
- -15 if no engagement in 30 days
- -10 if bounced or complained
- -5 for each failed payment in last 90 days

**Temperature buckets:**
- **Hot** (80-100) — active, engaged, recent purchase
- **Warm** (50-79) — active or recent, moderate engagement
- **Cold** (20-49) — dormant but not churned
- **At-risk** (0-19) — about to churn, or already gone

*The exact point values are tunable. Build a `scoring_config` table so you can edit weights in the UI without redeploying. After 2-3 months of data, you'll want to adjust based on what actually predicts retention.*

### Scoring jobs

A background worker recomputes scores:
- **On event** — whenever a relevant activity fires (payment, email event, cancellation), recompute just that user
- **Nightly** — recompute everyone to catch time-based decay (no engagement in 30 days → score drops)

Supabase cron + edge functions handle this cleanly.

---

## User profile view (the "360° customer view")

Click any user anywhere in the app → full profile page. This is the HubSpot contact page equivalent.

**Header:** name, email, verification badge, lead temperature pill, total LTV

**Tabs:**
1. **Overview** — lifecycle stage, first seen, current memberships, score breakdown showing which signals are driving it
2. **Memberships** — timeline of every product they've ever had, with statuses and dates. "Bought Monthly on 2025-03-01 → upgraded to Annual on 2025-08-14 → churned on 2026-02-01."
3. **Payments** — every charge, refund, dispute
4. **Emails** — every email sent to them, with open/click status. Click any email → preview what they got and when
5. **Activity** — unified timeline of everything (memberships, payments, emails, verification changes) in reverse chronological order
6. **Campaigns & cadences** — which they're currently in, which they've completed, which they'd match if sent now

**Actions on the profile:**
- Add to/remove from campaign
- Trigger a specific cadence manually
- Add internal note
- Add custom tag
- Force re-verify email
- View in MailerLite / Whop (deep links)

---

## Campaign builder

### From a segment

1. Open any segment → "Create campaign"
2. App creates a matching MailerLite group (syncs the exact users)
3. Campaign form: subject, preview, template (pick from MailerLite template library via their API), schedule
4. Hit send → app calls MailerLite API to send
5. Every member who receives it gets a `campaign_received` activity logged
6. Opens/clicks flow back via webhooks into `email_events`

### Campaign tagging

Every user who receives a campaign gets tagged with it in the `activities` table. This lets you later segment by "received Campaign X" — which is exactly what you asked for.

### Preventing over-sending

Hard rule: no user should get more than N campaigns per week (configurable, default 2). Before sending, the app checks `email_events` for recent sends to each user in the segment. Users who've already hit the limit get excluded automatically and you get a warning: "127 users excluded due to frequency cap."

This alone prevents the #1 way email programs tank deliverability.

---

## Cadence builder (automated sequences)

Same as the previous spec — drag-drop node editor, compiles to MailerLite automations. Triggers extended to include:

- Member enters lifecycle stage (e.g. "becomes trial")
- Member enters/exits segment
- Score crosses threshold (e.g. "drops below 20 = at-risk cadence fires")
- Specific product purchase
- Specific cancellation reason given
- Manual launch on a segment

---

## Build order (revised for full scope)

| Phase | Work | Days |
|---|---|---|
| 1 | Supabase schema (all tables above), Whop OAuth/API setup | 2 |
| 2 | Whop sync: products, plans, users, memberships, payments. Backfill + webhooks. | 3 |
| 3 | MailerCheck integration + verification workflow | 1 |
| 4 | MailerLite sync (groups, custom fields, upserts) + webhook receiver for engagement | 2 |
| 5 | Activity timeline writer (triggers on all entity changes) | 1 |
| 6 | Segment/filter engine (the JSON filter → SQL query translator) | 3 |
| 7 | Reports UI (segment list, table view, column customization, CSV export) | 2 |
| 8 | 10 starter report templates | 1 |
| 9 | Lead scoring engine + background workers | 2 |
| 10 | User profile 360° view (all 6 tabs) | 3 |
| 11 | Campaign builder (segment → send) | 2 |
| 12 | Cadence builder (node editor + MailerLite compile) | 4 |
| 13 | Frequency capping + over-send protection | 0.5 |
| 14 | Dashboard home (KPIs, recent activity, pending tasks) | 1 |
| 15 | End-to-end testing with real data | 2 |

**Total: ~30 working days.** Call it 6 weeks with buffer and the inevitable "wait, we need X too" moments.

**The cadence builder is still the single riskiest piece.** Everything else is plumbing and CRUD. If timeline gets tight, ship v1 without cadences — just campaigns — and add cadences as v1.1. Campaigns alone get you 70% of the value.

---

## Tech stack

- **Frontend:** Next.js 14, Tailwind, shadcn/ui, TanStack Table (for the big filterable grids)
- **Backend:** Next.js API routes + Supabase Edge Functions for background jobs
- **DB:** Supabase (Postgres). Use **row-level security** from day 1 — even as a single user, it's cheap insurance.
- **Realtime:** Supabase realtime subscriptions for the members table
- **Queue:** Inngest for webhook processing, scoring jobs, cadence execution. Free tier is generous and it's built for this exact use case.
- **Cadence editor:** React Flow
- **Email template picker:** Pull templates from MailerLite's API, render preview in iframe
- **Charts:** Recharts for analytics views
- **Deploy:** Vercel for the app, Supabase handles DB hosting

---

## API keys & env

```
WHOP_API_KEY                    # Company API key
WHOP_WEBHOOK_SECRET
MAILERLITE_API_KEY
MAILERLITE_WEBHOOK_SECRET
MAILERCHECK_API_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
INNGEST_SIGNING_KEY
INNGEST_EVENT_KEY
```

---

## Rate limits & gotchas

- **Whop backfill of payments** — this could be thousands of rows. Paginate at 50/page, 100ms between pages. Run as an Inngest background job, not a single HTTP request (it'll time out).
- **MailerLite 120 req/min** — fine for campaigns, but if you're syncing 10K+ users bulk, use `POST /api/groups/{id}/import-subscribers` which is a single async call.
- **MailerLite groups have no hierarchy** — so your product groups live only in your app, not mirrored in MailerLite. That's fine; MailerLite gets flat groups like "whop-active-trading-room" per product.
- **Webhook idempotency** — dedupe by event ID in every handler. Whop and MailerLite both retry on 5xx.
- **Score recomputation storms** — when you change scoring weights, don't recompute all users synchronously. Queue it, process at 100/sec.
- **Whop country field doesn't exist on members** — skip country-based segmentation for v1.
- **MailerLite double opt-in OFF for Whop sync** — these users already paid. Re-confirming via email nukes deliverability.

---

## What NOT to build

- **Own email sending.** MailerLite handles it.
- **Own verification engine.** MailerCheck at $0.01 is cheaper than anything you'd build.
- **Multi-user team features.** You're the only user. RLS is prep; don't build sharing UI yet.
- **Mobile app.** Responsive web is enough. You'll mostly use this at a desk.
- **AI content generation.** Use MailerLite's template library. AI email writing is not the competitive advantage.
- **Calling / SMS / Slack integration.** Email only for v1.
- **A/B testing of campaigns.** MailerLite has this built in. Use theirs.
- **Landing page builder.** Out of scope.

---

## Success criteria for v1

- Every Whop member (past and present) is in the app DB with full membership history
- You can answer "who bought Product X but not Product Y?" in under 10 seconds
- Lead scores update within 1 minute of any user activity
- You can build a report, save it as a segment, and send a campaign in under 5 minutes
- Every email sent is tied back to the member's profile and counts toward their engagement score
- Bounce rate stays under 1% because of upstream MailerCheck verification
- Frequency cap prevents any user from getting more than 2 campaigns/week without explicit override

---

## v1.1 and beyond (not in initial scope but worth noting)

- **Dashboards per product** — each product gets its own KPI page (MRR, churn, LTV, cohort retention)
- **Revenue forecasting** — based on current memberships + historical churn rates
- **A/B testing for cadences** — split users 50/50 across two cadence variants
- **Custom field framework** — let you define arbitrary per-user attributes beyond what Whop gives you
- **Webhook outbound** — fire events to Zapier/n8n when score crosses threshold, user cancels, etc.
- **API for your own tools** — read-only API on top of your own DB so you can pull into Retool, Notion, etc.
