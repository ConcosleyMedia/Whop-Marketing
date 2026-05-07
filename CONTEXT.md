# Whop CRM — Domain glossary

Living document of the domain language used across this codebase. When a term
appears in code or conversation that conflicts with what's here, fix one or
the other — never let the language drift.

---

## Customer-state vocabulary

### Lifecycle stage (`users.lifecycle_stage`)

Derived from membership status per ADR-0002 (the operator-canonical
mapping; see `lib/scoring/compute.ts` and the two views below).

| Stage      | Means                                            | From Whop statuses |
|------------|--------------------------------------------------|--------------------|
| `active`   | currently has access                             | `active` / `trialing` / `completed` (no cancel_at_period_end) |
| `canceling`| has access but it's going away                   | `past_due`, OR `active`/`trialing` + cancel_at_period_end=true |
| `churned`  | real ex-customer, no current access              | `canceled` / `expired` |
| `prospect` | never a real member                              | `drafted` only, or no memberships |

`completed` is "active" because for lifetime products, free-community
passes, and one-time deliveries Whop marks the membership `completed`
at the moment the user receives access cleanly — they keep it. `drafted`
is "prospect" because those are abandoned checkouts, not members.

**Lifecycle alone does NOT distinguish paying from non-paying.** A
free-community member reads as `active` with `total_ltv = 0`. A lifetime
Pro buyer also reads as `active` with `total_ltv = $60–90`. For real
audience targeting always combine `lifecycle_stage`, `total_ltv`, AND
the underlying plan.

**The mapping is duplicated in three places** that must stay in sync:
`lib/scoring/{compute,fetch}.ts` (writes `users.lifecycle_stage` on
every webhook), `segment_eligibility_view` (segments + cadence engine),
and `user_marketing_view` (user-facing pages). Consolidating to a single
view is on the followup list.

### Cohort matrix (operator-facing)

The operator thinks in cohorts that combine lifecycle, payment shape, and
engagement. These names are the canonical labels used in cadence/segment
descriptions. Counts below reflect the corrected lifecycle mapping
(2026-05-07; the original counts were skewed by misclassification).

| Cohort | `lifecycle_stage` | Payment shape | Count | Operator policy |
|---|---|---|---|---|
| **Active free community** | `active` | `total_ltv = 0`, free AutomationFlow | ~12,793 | **Welcome backfill in flight** — 4-touch cadence for those who joined >30 days ago and never received the welcome series (~12,556 eligible) |
| **Lifetime AutomationFlow Pro** | `active` (status=completed) | one-time $25–199 (cluster at $79) | ~90 | **Bespoke transition send** planned — single campaign offering 3 months free Build Room |
| **Paid recurring active** | `active` | recurring sub, paying now | ~244 | **DO NOT TOUCH** — "lazy non-cancellers"; poking risks waking them up to cancel |
| **Lapsed buyers** | `churned` | `total_ltv > 0`, last purchase >90d ago | 1,432 | **Targeted by Win-back · 60-day (active)** and **Lapsed buyers · 4-touch ($50K hook)** (paused) — pick one |
| **True Free silent** | `churned` | `total_ltv = 0`, canceled/expired free signup | 302 | small cohort — Pilot 0 cadence is paused pending audience re-pick |
| **Drafted-only (abandoned signups)** | `prospect` | never finalized signup | 2,115 | not customers — do not email as ex-members |

**Important:** the original "Free silent ~15k" was almost entirely
misclassification — Whop's `completed` status (free community pass,
lifetimes) was being treated as ex-membership, and `drafted` (abandoned
signups) as ex-members. With the canonical mapping (ADR-0002) the true
Free silent cohort is ~302 users. The much larger 12,793-user pool
historically called "Free silent" are ACTIVE free-community members who
just never engaged with email — they're the welcome-backfill audience.

"Inactive 15k" in earlier operator language conflated these two cohorts.
Going forward use **active free community** (engagement target) and
**true Free silent** (real reactivation) as separate names.

The "ignore currently-paying" posture is *current*, not permanent.
Re-evaluate after the new Build Room product is established and revenue
is stable.

---

## Product vocabulary

### AutomationFlow (free community)
The free community on Whop. Joining creates a $0-price membership; member
shows as `lifecycle_stage = active`, `total_ltv = 0`. As of May 2026 this
is being **repositioned** around Claude Code / Codex training under the new
Build Room banner. The free community itself stays — only the value
proposition changes.

### AutomationFlow Pro
The legacy paid product — an n8n automation tool sold as a lifetime
membership at $60–90 (after discounts/taxes). **Being archived May 2026:**
existing access remains, no new sales, no further development. Buyers of
this plan are the "Lifetime AutomationFlow Pro" cohort above.

### Build Room (new)
The new paid product, focused on Claude Code / Codex training. Replaces
AutomationFlow Pro as the paid offering.

A separate cadence, `Free signup · 10-day welcome` (renamed in migration
0017 from its earlier "Build Room · 10-day welcome" misnomer), fires on
new free AutomationFlow signups — `plan_yRLG1PNR7m8Yh`, ~19k historical
memberships. Its 10 templates were originally authored under a "Build
Room" working title (tags: `build-room`, `welcome-series`, `day-NN`) but
ship to free signups; copy-audit is a separate open issue.

---

## Communication vocabulary

### Cadence
A multi-step automated email sequence triggered by an event or segment entry.
Each user enrolls at most once per cadence (UNIQUE on `(cadence_id, user_id)`)
— so a cadence is *one shot per user, ever*, unless we add re-enrollment
machinery. Cadence sends are exempt from the frequency cap.

### Campaign
A one-shot broadcast to a segment. Counts against the frequency cap. Operator
authors and sends manually.

### Educational digest *(planned, not yet built)*
A recurring broadcast — content goes out on a weekly or bi-weekly schedule
to **engaged users only** (those with recent opens/clicks or currently
in an active cadence). Active recurring payers are excluded per the
"don't touch" rule. Distinct from a cadence (per-user-triggered) and
from a campaign (one-shot). **No primitive for this exists yet.**

Initial audience is small (handful of engagers from existing data) and
grows as reactivation pilots succeed. Fits within the existing 2,500
MailerLite plan at launch.

### Reactivation push *(planned)*
A one-time multi-touch sequence sent to a stale cohort to re-introduce the
product. Implemented as a cadence with a `segment_added` trigger and an
exit condition that fires on engagement or conversion. The Free-silent
reactivation push is the first instance.

---

## Operational constraints

### MailerLite seat cap
The MailerLite plan is the binding constraint on email volume. Subscribers
are billed cumulatively *within* a billing cycle — every email address that
was active at any point in the cycle counts, even if deleted before
month-end. Rotation within a cycle does NOT reduce billing. Cycles reset
monthly.

Implication: any reactivation push to >cap-size cohorts must either
(a) span multiple billing cycles, (b) temporarily upgrade the plan, or
(c) clear room by deleting accumulated `crm-user-*` groups.

### Current seat allocation (May 2026, 2,500-seat plan)
- **~2,070 seats: paid-ever cohort.** Held in MailerLite for future
  targeting. Active payers (~250) are intentionally untouched. Paid-recurring
  churned (~1,801) deferred to a later win-back. Lifetime AutomationFlow Pro
  (~90) gets a single bespoke transition send.
- **Headroom for new sends: ~430 seats** before the cap or overage.
- **DB ↔ MailerLite sync gap:** the `users.mailerlite_subscriber_id` column
  is null for all users despite ~2,070 actually being in MailerLite. Sync
  has never populated it. Any audience-selection logic in this codebase that
  relies on `mailerlite_subscriber_id` is currently broken.

### MailerLite AUP suspension thresholds
Stricter than industry baseline. Account suspension if any campaign exceeds:
- spam complaints >0.2%
- bounces >5%
- unsubscribes >1%
- open rate <3%

All four must hold for cold-list sends. Staged rollout (~178/day for the
14-day window) is non-negotiable.

### Per-user MailerLite groups accumulate
The send pattern (`crm-user-<userId>` group per recipient) was designed
without cleanup. Groups + subscribers persist indefinitely after cadence
completion, eating MailerLite seats. Cleanup is a prerequisite for any
push that exceeds current headroom.
