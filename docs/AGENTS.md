# CRM + EMAIL MANAGEMENT APP — IMPLEMENTATION BLUEPRINT
**For Claude Code | Full-App Build from Scratch**

> This document is the canonical agent instruction set for building the CRM + Email Management App end-to-end. Read top to bottom before writing a single line of code. Companion document: `NextSteps.md` contains the product spec; this document is the build order.

---

## 0. CONTEXT & SCOPE

This is a **purpose-built CRM and email marketing platform** for a Whop-based business. Think HubSpot + Pardot but narrowly scoped to: Whop (commerce system of record) → App DB (CRM brain) → MailerCheck (verification) → MailerLite (send engine) → App DB (engagement data flows back).

The user logs into this app to do everything:
- Manage 6-20 Whop products and see who bought what
- Run CRM reports (filter users by any combination of attributes)
- Send email campaigns with full tracking
- Automate cadences triggered by lifecycle events
- See lead scoring (hot / warm / cold / at-risk) on every user

**What is IN scope:**
- Next.js 14 app deployed to Vercel
- Supabase Postgres database with all entities from `NextSteps.md`
- Whop API integration (sync products, plans, members, memberships, payments)
- MailerCheck real-time verification
- MailerLite sync + campaign send + webhook ingestion
- Inngest for background jobs (sync, scoring, cadence execution)
- Full dashboard UI: members, reports, campaigns, cadences, user profiles

**What is NOT in scope (v1):**
- Mobile app
- Multi-tenant / team features (single user for now)
- Own email sending (use MailerLite)
- Own verification engine (use MailerCheck)
- SMS / Slack / push notifications
- AI content generation
- Landing page builder
- Any Whop features beyond data sync (no checkout flows, we're read-mostly)

---

## 1. HOSTING & INFRASTRUCTURE DECISIONS

**Read this section carefully. These decisions are hard to reverse.**

### 1.1 The stack (decided)

| Layer | Service | Why |
|---|---|---|
| Frontend + API | **Vercel** (Next.js 14 App Router) | Zero-config deploys, native Next.js support, edge functions for fast webhook processing |
| Database | **Supabase** (Postgres) | Full SQL, row-level security, realtime subscriptions, auth included if needed later |
| Background jobs | **Inngest** | Built for exactly this use case (webhook processing, scheduled scoring, cadence execution). Generous free tier. |
| Auth | **Supabase Auth** (magic link for the single admin user) | Already included with Supabase, nothing to set up separately |
| Email verification | **MailerCheck** | Native MailerLite family, $0.01/email |
| Email sending | **MailerLite** | Pre-existing account, handles deliverability |
| Commerce source | **Whop** | Pre-existing account, source of truth for all member/product data |

### 1.2 Why not alternatives

- **Why not Railway / Render?** Vercel's Next.js integration is tighter. You get preview deployments per PR for free, which matters when Claude Code is pushing changes rapidly.
- **Why not Neon / PlanetScale?** Supabase bundles Postgres + realtime + auth + storage + edge functions in one dashboard. Cheaper than assembling parts.
- **Why not raw Vercel Cron for background jobs?** Vercel Cron max runs every minute with 10-second timeout on Hobby. Webhooks and scoring jobs need longer execution and retries. Inngest is built for this.
- **Why not BullMQ / Redis-based queues?** More infra to manage. Inngest is serverless and handles everything we need.

### 1.3 Pricing expectations (production-ready)

**Month 1-3 (MVP, small user base):**
- Vercel Pro: $20/mo (need Pro for longer function execution than Hobby's 10-second limit)
- Supabase Pro: $25/mo (need Pro to avoid 7-day pause on inactivity)
- Inngest Free: $0 (25K steps/month included)
- MailerCheck: ~$10/mo (1000 verifications, pay-as-you-go)
- MailerLite: existing account
- **Total new infra cost: ~$55/month**

**At scale (10K+ Whop members, regular campaigns):**
- Vercel Pro: $20/mo + small bandwidth overage
- Supabase Pro: $25-75/mo depending on DB size and bandwidth
- Inngest: likely still free or $20/mo tier
- MailerCheck: $50-200/mo depending on campaign frequency
- **Total: ~$150-300/month**

### 1.4 Required accounts & access (get these ready BEFORE starting implementation)

- [ ] Vercel account with Pro plan active
- [ ] Supabase account with Pro plan active, new project created (note the project URL and service role key)
- [ ] Inngest account created, new app registered (note event key and signing key)
- [ ] Whop company API key created from `/dashboard/developer` with these permissions:
  - `member:basic:read`, `member:email:read`, `member:phone:read`
  - `access_pass:basic:read` (for products)
  - `plan:basic:read`
  - `payment:basic:read`
  - `company:authorized_user:read`
  - `developer:manage_webhook`
- [ ] MailerLite API key from `Account → Integrations → Developer API`
- [ ] MailerCheck account + API key from Account Settings → API
- [ ] GitHub repo created, connected to Vercel
- [ ] Domain name (optional for v1, `*.vercel.app` works fine initially)

### 1.5 Env vars (set these in Vercel project settings AND a local `.env.local`)

```
# Whop
WHOP_API_KEY=
WHOP_COMPANY_ID=
WHOP_WEBHOOK_SECRET=

# MailerLite
MAILERLITE_API_KEY=
MAILERLITE_WEBHOOK_SECRET=

# MailerCheck
MAILERCHECK_API_KEY=

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Inngest
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=

# App
NEXT_PUBLIC_APP_URL=
ADMIN_EMAIL=         # Single admin login email
```

---

## 2. DATA MODELS

Build these tables in Supabase **in this exact order** (dependencies matter). Create one migration file per phase — do not bundle into one giant migration.

### Migration 1 — Core entities

```sql
-- companies (usually 1 row)
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  whop_company_id TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- products
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  whop_product_id TEXT UNIQUE NOT NULL,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  headline TEXT,
  description TEXT,
  visibility TEXT,
  business_type TEXT,
  industry_type TEXT,
  route TEXT,
  member_count INT DEFAULT 0,
  product_group TEXT,              -- user-defined, e.g. "Trading", "Coaching"
  internal_tags TEXT[] DEFAULT '{}', -- user-defined tags
  is_active BOOLEAN DEFAULT TRUE,  -- soft-delete flag
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_products_company ON products(company_id);
CREATE INDEX idx_products_group ON products(product_group);

-- plans
CREATE TABLE plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  whop_plan_id TEXT UNIQUE NOT NULL,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  title TEXT,
  description TEXT,
  plan_type TEXT,                  -- 'renewal' or 'one_time'
  billing_period_days INT,
  initial_price NUMERIC(10,2),
  renewal_price NUMERIC(10,2),
  trial_period_days INT,
  currency TEXT DEFAULT 'usd',
  visibility TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_plans_product ON plans(product_id);
```

### Migration 2 — Users and memberships

```sql
-- users (one row per human)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  whop_user_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  username TEXT,
  first_seen_at TIMESTAMPTZ,
  -- verification
  verification_status TEXT,         -- 'sendable', 'do_not_send', 'typo', 'unverified'
  verification_raw TEXT,            -- raw MailerCheck response status
  verification_checked_at TIMESTAMPTZ,
  verification_suggestion TEXT,     -- for typo results
  -- mailerlite
  mailerlite_subscriber_id TEXT,
  mailerlite_groups TEXT[] DEFAULT '{}',
  -- derived
  lifecycle_stage TEXT,             -- 'prospect', 'trial', 'active', 'churned', 'winback'
  lead_score INT DEFAULT 0,
  lead_temperature TEXT,            -- 'hot', 'warm', 'cold', 'at_risk'
  total_ltv NUMERIC(10,2) DEFAULT 0,
  last_engagement_at TIMESTAMPTZ,
  -- internal
  internal_notes TEXT,
  custom_tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_lifecycle ON users(lifecycle_stage);
CREATE INDEX idx_users_temperature ON users(lead_temperature);
CREATE INDEX idx_users_score ON users(lead_score DESC);

-- memberships (time-series: one row per membership, NOT per-user-current-state)
CREATE TABLE memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  whop_membership_id TEXT UNIQUE NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  plan_id UUID REFERENCES plans(id),
  status TEXT NOT NULL,             -- 'trialing', 'active', 'past_due', 'canceled', 'expired', 'completed'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  joined_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  renewal_period_start TIMESTAMPTZ,
  renewal_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  cancel_option TEXT,
  cancellation_reason TEXT,
  total_spent_on_membership NUMERIC(10,2) DEFAULT 0,
  promo_code_id TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_memberships_user ON memberships(user_id);
CREATE INDEX idx_memberships_product ON memberships(product_id);
CREATE INDEX idx_memberships_status ON memberships(status);
CREATE INDEX idx_memberships_user_product ON memberships(user_id, product_id);
CREATE INDEX idx_memberships_joined ON memberships(joined_at DESC);
```

### Migration 3 — Payments and activities

```sql
-- payments (every charge ever)
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  whop_payment_id TEXT UNIQUE NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  membership_id UUID REFERENCES memberships(id),
  product_id UUID REFERENCES products(id),
  plan_id UUID REFERENCES plans(id),
  amount NUMERIC(10,2) NOT NULL,
  currency TEXT DEFAULT 'usd',
  status TEXT NOT NULL,
  substatus TEXT,
  paid_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  dispute_alerted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_payments_user ON payments(user_id);
CREATE INDEX idx_payments_product ON payments(product_id);
CREATE INDEX idx_payments_paid_at ON payments(paid_at DESC);

-- email_events (from MailerLite webhooks)
CREATE TABLE email_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,         -- 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'unsubscribed', 'complained'
  mailerlite_campaign_id TEXT,
  mailerlite_automation_id TEXT,
  app_campaign_id UUID,             -- FK to campaigns (set below)
  app_cadence_id UUID,              -- FK to cadences (set below)
  email_subject TEXT,
  clicked_url TEXT,
  bounce_reason TEXT,
  metadata JSONB DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_email_events_user ON email_events(user_id);
CREATE INDEX idx_email_events_type ON email_events(event_type);
CREATE INDEX idx_email_events_occurred ON email_events(occurred_at DESC);
CREATE INDEX idx_email_events_user_type ON email_events(user_id, event_type);

-- activities (unified timeline for display)
CREATE TABLE activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,      -- membership_started, upgraded, payment_succeeded, email_opened, score_changed, etc.
  related_entity_type TEXT,
  related_entity_id UUID,
  title TEXT NOT NULL,              -- display text
  description TEXT,
  metadata JSONB DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_activities_user_occurred ON activities(user_id, occurred_at DESC);
CREATE INDEX idx_activities_type ON activities(activity_type);
```

### Migration 4 — Campaigns, cadences, segments

```sql
-- segments (saved filters)
CREATE TABLE segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  filter_json JSONB NOT NULL,
  is_dynamic BOOLEAN DEFAULT TRUE,
  is_starter_template BOOLEAN DEFAULT FALSE,
  member_count INT DEFAULT 0,
  last_evaluated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- segment_members (materialized cache for dynamic segments)
CREATE TABLE segment_members (
  segment_id UUID REFERENCES segments(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (segment_id, user_id)
);
CREATE INDEX idx_segment_members_user ON segment_members(user_id);

-- campaigns (one-off broadcasts)
CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  segment_id UUID REFERENCES segments(id),
  mailerlite_campaign_id TEXT,
  mailerlite_group_id TEXT,
  subject TEXT NOT NULL,
  preview_text TEXT,
  mailerlite_template_id TEXT,
  from_name TEXT,
  from_email TEXT,
  status TEXT DEFAULT 'draft',      -- 'draft', 'scheduled', 'sending', 'sent', 'failed'
  scheduled_for TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  -- aggregates (updated by webhook ingestion)
  total_sent INT DEFAULT 0,
  total_delivered INT DEFAULT 0,
  total_opened INT DEFAULT 0,
  total_clicked INT DEFAULT 0,
  total_bounced INT DEFAULT 0,
  total_unsubscribed INT DEFAULT 0,
  total_complained INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- cadences (automated sequences)
CREATE TABLE cadences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  mailerlite_automation_id TEXT,
  trigger_type TEXT NOT NULL,       -- 'segment_enter', 'lifecycle_change', 'score_threshold', 'manual'
  trigger_config JSONB NOT NULL,
  sequence_json JSONB NOT NULL,     -- array of nodes: delay, email, condition
  status TEXT DEFAULT 'draft',      -- 'draft', 'active', 'paused', 'archived'
  total_enrolled INT DEFAULT 0,
  total_completed INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- cadence_enrollments (which users are in which cadence, at which step)
CREATE TABLE cadence_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cadence_id UUID REFERENCES cadences(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  current_step INT DEFAULT 0,
  status TEXT DEFAULT 'active',     -- 'active', 'completed', 'exited', 'failed'
  enrolled_at TIMESTAMPTZ DEFAULT NOW(),
  next_action_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  exit_reason TEXT,
  UNIQUE (cadence_id, user_id)
);
CREATE INDEX idx_cadence_enrollments_next_action ON cadence_enrollments(next_action_at) WHERE status = 'active';

-- Add FKs from email_events back to campaigns/cadences
ALTER TABLE email_events
  ADD CONSTRAINT fk_email_events_campaign
  FOREIGN KEY (app_campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL;
ALTER TABLE email_events
  ADD CONSTRAINT fk_email_events_cadence
  FOREIGN KEY (app_cadence_id) REFERENCES cadences(id) ON DELETE SET NULL;
```

### Migration 5 — Scoring config, frequency caps, admin

```sql
-- scoring_config (tunable without code changes)
CREATE TABLE scoring_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name TEXT UNIQUE NOT NULL,
  rule_description TEXT,
  points INT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default scoring rules
INSERT INTO scoring_config (rule_name, rule_description, points) VALUES
  ('has_active_paid_membership', 'User has any active paid membership', 20),
  ('purchased_last_30_days', 'User made a purchase in last 30 days', 15),
  ('opened_email_last_7_days', 'User opened an email in last 7 days', 10),
  ('clicked_email_last_14_days', 'User clicked an email in last 14 days', 10),
  ('on_multiple_products', 'User is active on 2+ products simultaneously', 5),
  ('ltv_over_500', 'User total LTV exceeds $500', 15),
  ('positive_engagement_trend', 'More opens this month than last', 10),
  ('cancel_at_period_end', 'Membership is scheduled to cancel', -20),
  ('no_engagement_30_days', 'No opens or clicks in 30 days', -15),
  ('bounced_or_complained', 'User has bounced or complained', -10),
  ('failed_payment_90_days', 'Failed payment in last 90 days (per failure)', -5);

-- frequency_cap_config
CREATE TABLE frequency_caps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  window_days INT NOT NULL,         -- rolling window
  max_emails INT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO frequency_caps (window_days, max_emails) VALUES (7, 2);

-- webhook_log (idempotency + debugging)
CREATE TABLE webhook_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,             -- 'whop' or 'mailerlite'
  event_id TEXT NOT NULL,
  event_type TEXT,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ,
  error TEXT,
  received_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (source, event_id)
);
CREATE INDEX idx_webhook_log_received ON webhook_log(received_at DESC);
```

### Migration 6 — Row-Level Security (RLS)

Enable RLS on every table even though we're single-user for now. It's cheap insurance.

```sql
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE segment_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE cadences ENABLE ROW LEVEL SECURITY;
ALTER TABLE cadence_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE scoring_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE frequency_caps ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_log ENABLE ROW LEVEL SECURITY;

-- Single admin-only policy for v1 (expand later for multi-user)
CREATE POLICY admin_all_access ON companies
  FOR ALL USING (auth.jwt() ->> 'email' = current_setting('app.admin_email', true));
-- Repeat for each table or use a loop in the migration.
```

---

## 3. PROJECT STRUCTURE

```
/
├── app/
│   ├── (auth)/
│   │   └── login/page.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx                    # Sidebar + top nav
│   │   ├── page.tsx                      # Home: KPIs + recent activity
│   │   ├── members/
│   │   │   ├── page.tsx                  # Main member table
│   │   │   └── [id]/page.tsx             # User 360° profile
│   │   ├── products/
│   │   │   ├── page.tsx                  # Product catalog
│   │   │   └── [id]/page.tsx             # Product detail + member list
│   │   ├── reports/
│   │   │   ├── page.tsx                  # Saved segments list
│   │   │   ├── new/page.tsx              # Segment builder
│   │   │   └── [id]/page.tsx             # Segment results view
│   │   ├── campaigns/
│   │   │   ├── page.tsx                  # Campaign list
│   │   │   ├── new/page.tsx              # Campaign builder
│   │   │   └── [id]/page.tsx             # Campaign results + analytics
│   │   ├── cadences/
│   │   │   ├── page.tsx
│   │   │   ├── new/page.tsx              # Node editor (React Flow)
│   │   │   └── [id]/page.tsx
│   │   └── settings/
│   │       ├── page.tsx
│   │       ├── scoring/page.tsx          # Tune scoring rules
│   │       └── integrations/page.tsx     # API key status
│   └── api/
│       ├── webhooks/
│       │   ├── whop/route.ts
│       │   └── mailerlite/route.ts
│       ├── sync/
│       │   ├── whop/route.ts             # Manual trigger for full resync
│       │   └── status/route.ts
│       ├── verify-email/route.ts         # MailerCheck proxy
│       ├── segments/
│       │   ├── evaluate/route.ts         # Runs filter → returns users
│       │   └── [id]/sync-to-mailerlite/route.ts
│       ├── campaigns/
│       │   ├── [id]/send/route.ts
│       │   └── [id]/schedule/route.ts
│       ├── cadences/
│       │   └── [id]/compile/route.ts     # Generates MailerLite automation
│       └── inngest/route.ts              # Inngest serve endpoint
├── lib/
│   ├── whop/
│   │   ├── client.ts
│   │   ├── sync.ts                       # Whop → DB sync functions
│   │   └── webhook-verify.ts
│   ├── mailerlite/
│   │   ├── client.ts
│   │   ├── sync.ts                       # DB → MailerLite sync
│   │   ├── groups.ts
│   │   └── webhook-verify.ts
│   ├── mailercheck/
│   │   └── client.ts
│   ├── supabase/
│   │   ├── client.ts
│   │   ├── server.ts
│   │   └── admin.ts                      # Service role client
│   ├── scoring/
│   │   ├── engine.ts                     # Core scoring logic
│   │   └── rules.ts                      # Rule loader from DB
│   ├── segments/
│   │   ├── filter-types.ts               # TS types for filter JSON
│   │   ├── compiler.ts                   # JSON filter → SQL query
│   │   └── starter-templates.ts
│   ├── cadences/
│   │   ├── types.ts
│   │   ├── compiler.ts                   # Node graph → MailerLite automation
│   │   └── executor.ts                   # Inngest step handler
│   ├── activities/
│   │   └── writer.ts                     # Centralized activity logger
│   └── frequency-cap.ts
├── inngest/
│   ├── client.ts
│   ├── functions/
│   │   ├── whop-backfill.ts
│   │   ├── whop-webhook-handler.ts
│   │   ├── mailerlite-webhook-handler.ts
│   │   ├── verify-pending.ts
│   │   ├── score-user.ts
│   │   ├── score-nightly.ts
│   │   ├── cadence-tick.ts
│   │   └── segment-refresh.ts
├── components/
│   ├── ui/                               # shadcn/ui components
│   ├── members/
│   │   ├── MemberTable.tsx
│   │   ├── MemberFilters.tsx
│   │   └── profile/
│   │       ├── ProfileHeader.tsx
│   │       ├── MembershipsTab.tsx
│   │       ├── PaymentsTab.tsx
│   │       ├── EmailsTab.tsx
│   │       ├── ActivityTab.tsx
│   │       └── ScoreBreakdown.tsx
│   ├── segments/
│   │   ├── FilterBuilder.tsx             # The JSON-tree visual builder
│   │   └── SegmentResultsTable.tsx
│   ├── campaigns/
│   │   └── CampaignBuilder.tsx
│   └── cadences/
│       ├── CadenceEditor.tsx             # React Flow editor
│       ├── nodes/
│       │   ├── TriggerNode.tsx
│       │   ├── DelayNode.tsx
│       │   ├── EmailNode.tsx
│       │   └── ConditionNode.tsx
│       └── Sidebar.tsx
├── hooks/
│   ├── useMembers.ts
│   ├── useSegment.ts
│   └── useRealtimeMembers.ts
├── types/
│   ├── database.types.ts                 # Generated from Supabase
│   └── index.ts
├── scripts/
│   ├── seed-starter-segments.ts
│   └── seed-scoring-rules.ts
└── docs/
    ├── NextSteps.md
    ├── AGENTS.md                         # this file
    └── WHOP_API_REFERENCE.md
```

---

## 4. IMPLEMENTATION ORDER (EXACT SEQUENCE FOR CLAUDE CODE)

This is the **canonical build order**. Do not skip phases. Each phase produces something verifiable before moving on.

### PHASE 0 — Project setup (half a day)

0.1 Init Next.js 14 project with TypeScript, Tailwind, ESLint
```bash
npx create-next-app@latest crm-app --typescript --tailwind --app --src-dir=false --import-alias="@/*"
```

0.2 Install dependencies:
```bash
npm install @supabase/supabase-js @supabase/ssr
npm install @whop/sdk
npm install inngest
npm install zod
npm install @tanstack/react-table @tanstack/react-query
npm install reactflow
npm install recharts
npm install date-fns
npm install lucide-react
npm install -D @types/node
```

0.3 Install shadcn/ui components as needed: table, button, card, dialog, select, input, badge, tabs, sheet, dropdown-menu, form, label, switch, tooltip.

0.4 Set up `lib/supabase/client.ts`, `lib/supabase/server.ts`, `lib/supabase/admin.ts` with the standard Next.js + Supabase SSR pattern.

0.5 Run all migrations in order (1 → 6). Verify tables exist in Supabase dashboard.

0.6 Generate TypeScript types: `npx supabase gen types typescript --project-id=$PROJECT_ID > types/database.types.ts`

0.7 Commit. Deploy to Vercel. Verify health check at `/` returns a "Hello, CRM" placeholder.

**Verification:** Visit the Vercel URL, see the placeholder. Supabase has all tables. No data yet.

---

### PHASE 1 — Auth + app shell (half a day)

1.1 Build magic-link login page at `app/(auth)/login/page.tsx` using Supabase Auth. Only allow the `ADMIN_EMAIL` env var to log in.

1.2 Middleware at root that redirects unauthenticated users to `/login` and non-admin emails to an error page.

1.3 Build `app/(dashboard)/layout.tsx` with:
- Left sidebar: Home, Members, Products, Reports, Campaigns, Cadences, Settings
- Top bar: user menu with logout

1.4 Home page `app/(dashboard)/page.tsx`: empty placeholder "Welcome, stats coming soon"

1.5 Build each top-level page with an empty state. All nav links work, all pages load.

**Verification:** Log in as admin, navigate to every page without errors.

---

### PHASE 2 — Whop sync foundation (2 days)

2.1 Build `lib/whop/client.ts` — thin wrapper around the Whop SDK using `WHOP_API_KEY` and `WHOP_COMPANY_ID`.

2.2 Build `lib/whop/sync.ts` with these functions (each takes a `Whop` client and a Supabase admin client):
- `syncCompany()` — fetches company, upserts to `companies`
- `syncProducts()` — paginates `GET /products`, upserts each to `products`
- `syncPlans()` — paginates `GET /plans`, upserts each to `plans`
- `syncUsers(batchSize=100)` — paginates members, upserts the `user` portion of each to `users`
- `syncMemberships(batchSize=100)` — paginates members, creates/updates a `memberships` row per Whop member. **Critical:** this handles the time-series logic — if a Whop member's status changed, update the existing row, don't create a new one. Use `whop_membership_id` as the idempotency key.
- `syncPayments(sinceDate?)` — paginates `GET /payments` with optional date filter, upserts to `payments`. Links to user, membership, product, plan via their Whop IDs.
- `syncAll()` — calls the above in order, returns a summary report

2.3 Create Inngest function `inngest/functions/whop-backfill.ts`:
```typescript
export const whopBackfill = inngest.createFunction(
  { id: "whop-backfill", retries: 3 },
  { event: "whop/backfill.requested" },
  async ({ step }) => {
    await step.run("sync-company", async () => syncCompany(...));
    await step.run("sync-products", async () => syncProducts(...));
    await step.run("sync-plans", async () => syncPlans(...));
    await step.run("sync-users", async () => syncUsers(...));
    await step.run("sync-memberships", async () => syncMemberships(...));
    await step.run("sync-payments", async () => syncPayments(...));
    return { status: "complete" };
  }
);
```

2.4 Create `app/api/inngest/route.ts` that serves Inngest functions.

2.5 Build trigger UI at `app/(dashboard)/settings/integrations/page.tsx`:
- "Run Full Sync" button → POSTs to `/api/sync/whop` → dispatches Inngest event
- Show last sync status, last sync time, record counts per table

2.6 Run full sync. Verify in Supabase:
- `companies` has 1 row
- `products` has all your products
- `plans` has all plans
- `users` has every member's unique user
- `memberships` has 1 row per membership (may be > users if some have bought multiple products)
- `payments` has every historical payment

**Verification:** Query `SELECT COUNT(*) FROM users; SELECT COUNT(*) FROM memberships; SELECT COUNT(*) FROM payments;` — numbers match Whop dashboard.

---

### PHASE 3 — Whop webhooks (1 day)

3.1 Build `lib/whop/webhook-verify.ts` — HMAC signature verification using `WHOP_WEBHOOK_SECRET`.

3.2 Build `app/api/webhooks/whop/route.ts`:
- Verifies signature (reject with 401 if bad)
- Dedupe by `event.id` against `webhook_log` table
- Insert into `webhook_log`
- Dispatch Inngest event `whop/webhook.received` with the payload
- Return 200 fast (< 3 seconds)

3.3 Build `inngest/functions/whop-webhook-handler.ts`:
- Handles these event types:
  - `membership.activated` → upsert `users` + `memberships`, set lifecycle_stage
  - `membership.deactivated` → update `memberships.status`, set `canceled_at`
  - `membership.cancel_at_period_end_changed` → update flag
  - `payment.succeeded` → upsert `payments`, update `memberships.total_spent_on_membership`
  - `payment.failed` → upsert `payments` with status, log activity
- After each handler: writes to `activities` table

3.4 Register webhook in Whop dashboard → Developer → Webhooks, point at `https://yourdomain.vercel.app/api/webhooks/whop`.

3.5 Trigger a test webhook from Whop dashboard. Verify it appears in `webhook_log` with `processed_at` set.

**Verification:** Make a test purchase (or have someone) in Whop → within 30 seconds the new member appears in `users` and `memberships`.

---

### PHASE 4 — MailerCheck verification (1 day)

4.1 Build `lib/mailercheck/client.ts`:
- `verifyEmail(email: string)` → calls MailerCheck real-time API
- Returns normalized `{ status: 'sendable' | 'do_not_send' | 'typo' | 'error', raw: string, suggestion?: string }`

4.2 Build `app/api/verify-email/route.ts`:
- Accepts `{ email }`, calls `verifyEmail()`, returns result
- Rate-limit by IP (use Vercel's built-in or simple in-memory)

4.3 Build `inngest/functions/verify-pending.ts`:
- Triggered by `user/verification.needed` event
- Finds users where `verification_checked_at IS NULL OR verification_checked_at < NOW() - INTERVAL '90 days'`
- Processes 10 users/second (MailerCheck rate limit cushion)
- Updates `users.verification_status`, `verification_raw`, `verification_checked_at`, `verification_suggestion`
- Writes activity row

4.4 Trigger verification for all existing users: dispatch `user/verification.needed` event after Phase 2 backfill completes.

4.5 After a bounce webhook from MailerLite (Phase 6), re-verify that email.

**Verification:** Run the bulk verification job, then query `SELECT verification_status, COUNT(*) FROM users GROUP BY verification_status` — you should see a distribution of sendable/do_not_send/typo.

---

### PHASE 5 — MailerLite sync (2 days)

5.1 **One-time manual setup in MailerLite dashboard:**
- Turn OFF "Double opt-in for API and integrations" (Account Settings → Subscribe settings)
- Create groups: `whop-trialing`, `whop-active`, `whop-past-due`, `whop-canceled`, `do-not-send`
- Create custom fields (text unless noted): `whop_user_id`, `whop_status`, `joined_at` (date), `total_spent` (number), `product`, `verification_status`, `lead_score` (number), `lead_temperature`
- Note all group IDs and field names, store in Supabase `config` table or env vars

5.2 Build `lib/mailerlite/client.ts` — thin wrapper around MailerLite REST API.

5.3 Build `lib/mailerlite/sync.ts`:
- `syncUserToMailerLite(userId)`:
  - Fetch user + their active memberships from DB
  - Determine which group they belong to based on their "best" active membership status
  - If `verification_status != 'sendable'`, put in `do-not-send` group only
  - POST to `/api/subscribers` with email + fields + groups
  - Store `mailerlite_subscriber_id` on the user
  - If user was previously in a different group, DELETE from old group
- `bulkSyncAllUsers()` — iterates, calls per-user, respects MailerLite's 120/min limit

5.4 Build `lib/activities/writer.ts` — a single function for writing activity rows. Used throughout the app.

5.5 Hook up automatic sync:
- When Whop webhook updates a `users` or `memberships` row → dispatch `user/sync.mailerlite` event
- Inngest function `sync-user-mailerlite.ts` calls `syncUserToMailerLite()`
- Add same dispatch after MailerCheck verification completes (so do_not_send users get routed correctly)

5.6 Run `bulkSyncAllUsers()` from the settings page as a one-time initial push.

**Verification:** Log into MailerLite, see all your Whop users in the correct groups, all custom fields populated.

---

### PHASE 6 — MailerLite webhook ingestion (1 day)

6.1 Register MailerLite webhooks via their API for these events:
- `subscriber.created`, `subscriber.updated`, `subscriber.unsubscribed`, `subscriber.bounced`
- `campaign.sent`, `campaign.opened`, `campaign.clicked`
- `automation.email.sent`, `automation.email.opened`, `automation.email.clicked`

Point at `https://yourdomain.vercel.app/api/webhooks/mailerlite`.

6.2 Build `lib/mailerlite/webhook-verify.ts` — signature verification.

6.3 Build `app/api/webhooks/mailerlite/route.ts`:
- Verify signature
- Dedupe via `webhook_log`
- Dispatch Inngest event `mailerlite/webhook.received`
- Return 200

6.4 Build `inngest/functions/mailerlite-webhook-handler.ts`:
- Match subscriber by `mailerlite_subscriber_id` → resolve to our `user_id`
- Insert row into `email_events` table
- Update derived fields on `users`: `last_engagement_at`, `last_opened_at`, `last_clicked_at`
- If event is `bounced` or `complained`:
  - Set user's `verification_status = 'do_not_send'`
  - Move to MailerLite `do-not-send` group
  - Trigger re-verification
- If event is on a campaign → increment aggregate counters on the `campaigns` row
- Write activity row

6.5 Send a test campaign from MailerLite to yourself, verify the open event lands in `email_events`.

**Verification:** Send test email, click it, verify you see both events in `email_events` and on your own user profile's activity tab.

---

### PHASE 7 — Segment/filter engine (3 days)

7.1 Build `lib/segments/filter-types.ts` — TypeScript types for the filter JSON structure:
```typescript
type FilterCondition = {
  field: string;        // e.g. "memberships.product_id"
  op: 'equals' | 'not_equals' | 'in' | 'not_in' | 'before' | 'after' | 'between' | 'contains' | 'is_null' | 'is_not_null';
  value: any;
};
type FilterGroup = {
  match: 'all' | 'any';
  conditions: (FilterCondition | FilterGroup)[];
};
```

7.2 Build `lib/segments/compiler.ts` — the JSON filter → SQL translator:
- Takes a `FilterGroup`, returns a Supabase query or raw SQL
- Supports joins: `users` always base, joins to `memberships`, `payments`, `email_events` as needed
- Handles aggregates: "has at least one membership where status = 'active'"
- Returns the query builder object (not executed yet)

7.3 Whitelist of allowed fields (security — no arbitrary SQL):
```
users.email, users.name, users.lifecycle_stage, users.lead_score, users.lead_temperature,
users.total_ltv, users.last_engagement_at, users.first_seen_at, users.verification_status,
memberships.product_id, memberships.product_group (via join), memberships.status,
memberships.joined_at, memberships.canceled_at, memberships.cancellation_reason,
payments.amount (aggregate), payments.paid_at (latest),
email_events.event_type (exists), email_events.occurred_at (latest)
```

7.4 Build segment API:
- `POST /api/segments/evaluate` — takes filter JSON, returns users + count
- `POST /api/segments` — save a segment (name + filter)
- `GET /api/segments/:id` — get segment with current members
- `POST /api/segments/:id/refresh` — re-evaluate dynamic segment, update `segment_members`

7.5 Build UI `components/segments/FilterBuilder.tsx`:
- Visual JSON tree editor
- Add/remove conditions
- Group toggle (all / any)
- Nested groups supported
- Live count preview as user builds (debounced)

7.6 Build `app/(dashboard)/reports/new/page.tsx` using the FilterBuilder.

7.7 Build `app/(dashboard)/reports/[id]/page.tsx` showing the results table with:
- All users matching the filter
- Columns: email, name, lifecycle, score, temperature, LTV, products, last engagement
- Customize columns button
- Export CSV button
- "Send to MailerLite" button (implemented in Phase 8)

7.8 Seed starter segments (from `scripts/seed-starter-segments.ts`):
1. New subscribers this month
2. New subscribers this month (per product — one per product)
3. At-risk churn (active + cancel_at_period_end OR low engagement)
4. Failed payment recovery
5. Trial ending in 3 days
6. Churned last 30 days
7. Top spenders (LTV > $500)
8. Engaged but not converted
9. Cross-sell candidates (template, user picks product A and B)
10. Reactivation targets (churned 60-180 days ago, still sendable)

**Verification:** Each starter segment returns a sensible list. You can build a custom segment like "Users who bought Product X but not Product Y" and it returns the correct users.

---

### PHASE 8 — Campaigns (2 days)

8.1 Build `lib/mailerlite/groups.ts`:
- `syncSegmentToGroup(segmentId, groupName)` — creates/updates a MailerLite group matching the segment's current members. Diff against current group members, add/remove as needed.

8.2 Build `app/api/segments/:id/sync-to-mailerlite/route.ts` — calls `syncSegmentToGroup`.

8.3 Build campaign API:
- `POST /api/campaigns` — create draft
- `POST /api/campaigns/:id/send` — push to MailerLite, schedule or send immediately
- `POST /api/campaigns/:id/schedule` — set future send time

8.4 Build `app/(dashboard)/campaigns/new/page.tsx`:
- Step 1: select segment (or "create new from filter")
- Step 2: subject, preview text, from name, from email
- Step 3: pick a MailerLite template from their template library (fetch via API)
- Step 4: review + send / schedule
- **Critical:** Before sending, check frequency cap — exclude users who've received >= 2 emails in last 7 days. Show count of excluded users with warning: "X users excluded due to frequency cap."

8.5 Build `lib/frequency-cap.ts`:
- `getEligibleUsers(userIds: string[])` → returns subset who are NOT over the cap
- Queries `email_events` for each user

8.6 On campaign send, write a `campaign_received` activity for each recipient.

8.7 Build `app/(dashboard)/campaigns/[id]/page.tsx` — campaign results:
- Headline stats: sent, delivered, opened, clicked, bounced, unsubscribed
- Open rate, click rate, bounce rate
- Recipient list with per-user engagement
- Time-series chart of opens/clicks over first 72 hours

**Verification:** Send a real test campaign to a segment of 2-3 test users. Verify aggregates populate correctly over next few minutes, activities log on each user.

---

### PHASE 9 — Lead scoring (2 days)

9.1 Build `lib/scoring/rules.ts` — loads active rules from `scoring_config` table, caches in memory for 5 minutes.

9.2 Build `lib/scoring/engine.ts` — `computeScore(userId)`:
- Fetches user + all related data (memberships, payments, email_events last 30 days)
- Evaluates each rule against the user's data
- Sums points, clamps 0-100
- Determines temperature bucket (80+ hot, 50-79 warm, 20-49 cold, <20 at-risk)
- Returns `{ score, temperature, breakdown: { rule_name: points_awarded }}`

9.3 Build Inngest function `inngest/functions/score-user.ts`:
- Triggered by `user/score.recompute` event
- Calls `computeScore`, updates `users.lead_score` and `users.lead_temperature`
- If score changed by > 10 points, writes activity row

9.4 Dispatch `user/score.recompute` after every:
- Membership status change
- New payment
- Email event
- Verification change

9.5 Build Inngest function `inngest/functions/score-nightly.ts`:
- Cron schedule: `0 4 * * *` (4am UTC daily)
- Iterates all users, recomputes score (catches time-based decay like "no engagement in 30 days")
- Batched at 100 users/sec

9.6 Build `components/members/profile/ScoreBreakdown.tsx`:
- Shows current score + temperature pill
- Lists each rule that contributed with +/- points
- Explains "Score last updated X minutes ago"

9.7 Build `app/(dashboard)/settings/scoring/page.tsx`:
- Table of all scoring rules from `scoring_config`
- Each row editable: points value, active toggle
- Save triggers full recompute (dispatches events for all users in batches)

**Verification:** Pick a user, view their profile, see a reasonable score breakdown. Change a rule weight in settings, watch that user's score update within a minute.

---

### PHASE 10 — User 360° profile (3 days)

10.1 Build `app/(dashboard)/members/[id]/page.tsx` with tabs:

**Tab 1: Overview**
- Header: avatar, name, email, verification badge, temperature pill
- KPIs: total LTV, first seen, active memberships count, last engagement
- Current lifecycle stage
- Score breakdown (from 9.6)
- Internal notes editor
- Custom tags editor

**Tab 2: Memberships**
- Timeline view of all memberships ever
- Each row: product, plan, status, joined_at, canceled_at, total spent
- Click expands to show: cancellation reason, renewal history, associated payments

**Tab 3: Payments**
- Every payment in chronological order
- Amount, status, product, plan, paid_at
- Refunds and disputes highlighted

**Tab 4: Emails**
- Every email ever sent to this user
- Columns: subject, campaign/cadence name, sent_at, opened (✓), clicked (✓), bounced
- Click email → see full details + preview (if template available)

**Tab 5: Activity**
- Unified reverse-chronological feed from `activities` table
- Filter: all, lifecycle events only, emails only, payments only
- Infinite scroll

**Tab 6: Campaigns & Cadences**
- Currently enrolled in (active cadences)
- History (completed cadences, received campaigns)
- Matches for: segments this user is currently in (informational)

10.2 Actions dropdown (top right of profile):
- Add to campaign (opens picker, filters eligible)
- Trigger cadence (opens picker)
- Force re-verify email
- Open in MailerLite (deep link)
- Open in Whop (deep link)

10.3 Build `components/members/MemberTable.tsx` using TanStack Table:
- Virtual scrolling for large lists
- Sortable columns
- Multi-select with bulk actions
- Filters via `FilterBuilder` (same component as segments)
- Click row → navigate to profile

**Verification:** Every user has a rich profile. You can see the exact story of their relationship with your business. Bulk-select 10 users and add them to a campaign.

---

### PHASE 11 — Cadence builder (4 days)

**This is the riskiest phase. Budget buffer. If tight on time, defer to v1.1.**

11.1 Build `lib/cadences/types.ts` — node types:
```typescript
type TriggerNode = { type: 'trigger', trigger: 'segment_enter' | 'lifecycle_change' | 'score_threshold' | 'manual' | 'purchase_product', config: any };
type DelayNode = { type: 'delay', minutes: number };
type EmailNode = { type: 'email', subject: string, previewText: string, mailerliteTemplateId: string };
type ConditionNode = { type: 'condition', check: 'opened_last_email' | 'clicked_last_email' | 'in_segment' | 'score_above', config: any, yesBranch: string[], noBranch: string[] };
type ExitNode = { type: 'exit', reason?: string };
```

11.2 Build `components/cadences/CadenceEditor.tsx` using React Flow:
- Canvas with draggable nodes
- Sidebar with node types (drag into canvas)
- Connect nodes with edges (output → input)
- Click node → sidebar opens with properties editor
- Validate on save: must have trigger, must end in exit, no cycles

11.3 Build `lib/cadences/compiler.ts` — `compileCadenceToMailerLite(cadenceId)`:
- Loads cadence definition
- Translates to MailerLite automation steps via their API
- Creates or updates the automation
- Stores `mailerlite_automation_id` on the cadence row
- Handles re-compilation when cadence is edited

11.4 Build `app/api/cadences/:id/compile/route.ts` — endpoint.

11.5 Build Inngest function `inngest/functions/cadence-tick.ts`:
- Runs every minute (cron)
- Finds `cadence_enrollments` where `next_action_at <= NOW() AND status = 'active'`
- For each, advances to next step (MailerLite handles the actual send)
- Updates `current_step`, `next_action_at`
- If end reached, marks `completed`

11.6 Build enrollment triggers:
- When a user enters a segment that matches a cadence's trigger_config → enroll them
- When a user's lifecycle changes → check all lifecycle-triggered cadences
- When a score crosses a threshold → check score-triggered cadences

11.7 Build `app/(dashboard)/cadences/new/page.tsx` with the editor.

11.8 Build `app/(dashboard)/cadences/[id]/page.tsx`:
- Editor view (edit existing)
- Analytics: enrolled, completed, exited, conversion rate
- Per-step drop-off funnel
- List of currently enrolled users

11.9 Ship with 4 starter cadence templates (pre-built in `scripts/seed-starter-cadences.ts`):
- New trial welcome (Day 0, 3, 6)
- Churn recovery (Day 1, 7, 30)
- Active member nurture (monthly value + quarterly survey)
- Past due rescue (Day 1, 3, 7)

**Verification:** Build a 3-step cadence in the editor, enroll a test user, watch the steps execute at the right times. Edit the cadence, verify it re-compiles in MailerLite.

---

### PHASE 12 — Home dashboard + product catalog (1 day)

12.1 Build `app/(dashboard)/page.tsx`:
- KPI cards: total members, active members, MRR, this month's new subscribers
- Recent activity feed (last 20 activities across all users)
- Top 5 cadences by enrollment
- Recent campaigns with open rates
- At-risk churn count (link to segment)

12.2 Build `app/(dashboard)/products/page.tsx`:
- Grid of all products with member counts, active subs, MRR per product
- Click a product → detail page with member list for that product, cross-sell opportunities

12.3 Build `app/(dashboard)/products/[id]/page.tsx`:
- Product header with Whop details
- Editable: `product_group`, `internal_tags`, `is_active`
- Member list (all-time, with current status)
- "Users who bought X but not this product" reverse cross-sell view

**Verification:** Landing dashboard gives you a business-at-a-glance view. Product catalog gives you per-product insight.

---

### PHASE 13 — End-to-end testing (2 days)

13.1 Test the full loop with a real Whop member:
- Make a purchase in Whop
- Verify member appears in app DB within 30 seconds
- Verify verification runs automatically
- Verify member appears in MailerLite in correct group
- Create a segment matching this member
- Send a test campaign to that segment
- Verify email arrives
- Open the email
- Verify the open appears in app within 60 seconds
- Verify activity log on user profile has all steps

13.2 Test cancellation flow:
- Cancel the test membership in Whop
- Verify status updates
- Verify MailerLite group changes to `whop-canceled`
- Verify activity logged

13.3 Test bounce handling:
- Add a fake bouncing address, trigger a campaign
- Verify bounce event received
- Verify user moved to `do-not-send` group
- Verify `verification_status` updated

13.4 Load test the sync:
- If you have >1000 historical members, run a full resync and time it
- Verify no duplicates, no dropped records

13.5 Test frequency capping:
- Send 2 campaigns to the same user in a 7-day window
- Try to send a 3rd — verify they are excluded with warning

---

## 5. CONVENTIONS & STANDARDS

### 5.1 Code style
- TypeScript strict mode ON
- All API responses typed via zod schemas
- No `any` without a `// eslint-disable` comment explaining why
- Prefer composition over inheritance
- Small functions (< 50 lines) — break up complexity

### 5.2 Error handling
- All external API calls wrapped with try/catch
- Failed webhooks: log to `webhook_log.error`, return 500 so they retry
- User-facing errors: use toast notifications (sonner), never alert()
- Log server errors to console for Vercel's built-in logging

### 5.3 Database access
- From server components / API routes: use `lib/supabase/server.ts`
- From Inngest functions: use `lib/supabase/admin.ts` (service role, bypasses RLS)
- From client components: use `lib/supabase/client.ts` (respects RLS)
- **Never** expose service role key to client

### 5.4 Webhook idempotency
Every webhook handler follows this pattern:
```typescript
const existing = await supabase
  .from('webhook_log')
  .select('id')
  .eq('source', 'whop')
  .eq('event_id', payload.id)
  .maybeSingle();
if (existing.data) return { skipped: true }; // already processed
// insert into webhook_log, then process
```

### 5.5 Activity logging
**Every** meaningful state change writes to `activities`. Don't skip this even when annoying. It's what powers the UI and the debugging experience.

### 5.6 Commits
- One commit per logical change
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`
- Commit after each phase completes verification
- Never commit secrets or `.env` files

---

## 6. KNOWN GOTCHAS

### 6.1 Whop API
- Backfill payments can take a while for large histories. Always run as Inngest job, not sync HTTP request.
- Whop member objects don't include country — this is a known API gap, skip country-based segmentation.
- Member `access_level` field is deprecated; use `status` field.
- IDs are Base64-obfuscated; store as TEXT not any numeric type.

### 6.2 MailerLite
- 120 req/min hard limit. For >100 subscriber syncs, use the bulk import endpoint.
- Double opt-in for API must be OFF (do it in Settings, not per-request).
- Groups have no hierarchy. The `product_group` field only lives in your app.
- Custom fields must be created before first sync, or the subscriber create call will fail.
- Removing from a group requires a separate API call — it's not an upsert.

### 6.3 MailerCheck
- `unknown` status on corporate domains is common and should NOT be rejected — too many false positives.
- Cache verification results 90 days. Re-verify only on bounce.
- Rate limit not publicly documented, but aim for < 100 req/sec.

### 6.4 Inngest
- Step functions are idempotent — if a step fails and retries, already-completed steps skip.
- Max step runtime is currently 2 hours on free tier.
- Events are fire-and-forget; use `step.sendEvent` for chaining.

### 6.5 Supabase
- Pro plan required for production (Free pauses after 7 days of inactivity).
- Enable connection pooling (pgbouncer transaction mode) for serverless.
- Realtime subscriptions have connection limits per plan — don't subscribe to the whole members table, filter server-side.

### 6.6 Vercel
- Hobby plan has 10-second function timeout. Pro required for the longer webhook handlers.
- Cron jobs on Hobby are minute-minimum; we use Inngest instead which has more flexibility.

---

## 7. VERIFICATION CHECKLIST (DO NOT SHIP WITHOUT)

- [ ] Every migration runs cleanly on a fresh Supabase project
- [ ] Full Whop sync completes without errors for real data
- [ ] A new Whop purchase propagates to app DB < 30 seconds via webhook
- [ ] MailerCheck verification runs and correctly categorizes a test batch
- [ ] A member synced to MailerLite shows up with all custom fields populated
- [ ] A test campaign sends to a segment, opens/clicks flow back, profile shows events
- [ ] A bounce on a test email moves the user to `do-not-send` and re-verifies
- [ ] Lead scoring runs on a user and breakdown makes logical sense
- [ ] Starter segments all return non-error results (may be empty)
- [ ] Frequency cap correctly excludes overused users with warning
- [ ] Cadence builder creates a cadence that compiles successfully to MailerLite
- [ ] User profile shows complete timeline of real member's history
- [ ] CSV export from any segment works
- [ ] Product catalog shows accurate member counts matching Whop dashboard
- [ ] Auth blocks non-admin emails
- [ ] All tables have RLS enabled
- [ ] No secrets in the repo (check .env.local is gitignored)

---

## 8. POST-V1 ROADMAP (NOT IN SCOPE FOR THIS BUILD)

Do not build these during v1 even if tempting:

- Per-product revenue dashboards
- Cohort retention visualization
- A/B testing for cadences
- Custom field framework (user-defined attributes beyond Whop)
- Outbound webhook system (fire to Zapier when events happen)
- Read-only public API
- Revenue forecasting models
- Multi-user team features with per-user permissions
- Mobile app or responsive mobile UX optimization beyond "doesn't break"

Ship v1, use it for a month, then decide which of these actually matter based on real usage.

---

## 9. GETTING UNSTUCK

If Claude Code gets stuck during implementation:

1. **Missing data from Whop?** Check the permissions on the API key. Most failures are missing scopes.
2. **MailerLite returning 422?** Almost always a missing custom field. Create it in their dashboard first.
3. **Webhook not firing?** Verify the webhook URL in Whop/MailerLite points at the deployed Vercel URL, not localhost.
4. **Inngest not running?** Check the signing key matches between Vercel env and Inngest dashboard.
5. **Supabase query slow?** Add an index. The ones in migrations cover the common cases, but custom segments may need more.
6. **Filter compiler returns wrong results?** The issue is almost always join semantics on `memberships`. Remember: a user can have multiple memberships; "has product X" needs `EXISTS` semantics, not `WHERE`.
7. **Lead score stuck at 0?** The rules table is empty or all inactive. Check `SELECT * FROM scoring_config WHERE is_active = true`.

When truly stuck, stop implementation and write a brief question back — don't guess.
