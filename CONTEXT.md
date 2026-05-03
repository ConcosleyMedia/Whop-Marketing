# Whop CRM — Domain glossary

Living document of the domain language used across this codebase. When a term
appears in code or conversation that conflicts with what's here, fix one or
the other — never let the language drift.

---

## Customer-state vocabulary

### Lifecycle stage (`users.lifecycle_stage`)
Derived from membership status (see `lib/scoring/`):
- `active` — has at least one active membership *of any kind, including free
  and lifetime*
- `churned` — has had at least one membership in the past, none active now
- `prospect` — has never had a membership

**Lifecycle stage alone does NOT distinguish paying from non-paying members,
nor recurring from one-time buyers.** A free-community member with no
purchases reads as `active` with `total_ltv = 0`. A lifetime AutomationFlow
Pro buyer also reads as `active` (forever) with `total_ltv = $60–90`. For
real audience targeting, always combine `lifecycle_stage`, `total_ltv`, AND
the underlying plan.

### Cohort matrix (operator-facing)

The operator thinks in cohorts that combine lifecycle, payment shape, and
engagement. These names are the canonical labels used in cadence/segment
descriptions.

| Cohort | `lifecycle_stage` | Payment shape | Count (May 2026) | Operator policy |
|---|---|---|---|---|
| **Free silent** | `churned` | `total_ltv = 0` | **15,022** (15,007 never engaged) | **TARGET** — primary nurture audience |
| **Lifetime AutomationFlow Pro** | `active` | one-time payment, $25–199 historical (cluster at $79) | ~90–115 | **Bespoke transition send** — single campaign offering 3 months free Build Room. They already know Pro is sunsetting; no need to re-explain. |
| **Paid recurring active** | `active` | recurring sub, paying now | ~250 | **DO NOT TOUCH** — "lazy non-cancellers"; poking risks waking them up to cancel |
| **Paid recurring churned** | `churned` | `total_ltv > 0`, had recurring sub | 1,801 | low priority — classic win-back, deferred |
| **Free churned (tire-kickers)** | `churned` | `total_ltv = 0`, joined free, never returned | overlaps with Free silent definition above | merged into Free silent — distinguishing them isn't worth the complexity |

**Important:** Free silent are `lifecycle_stage = 'churned'`, not `'active'`. Whop free
AutomationFlow memberships transition out of `active` over time, so the cohort
shows as churned in the data. Earlier confusion in this doc has been corrected.

"Inactive 15k" in operator language means **Free silent** specifically — not
the broader "anyone who hasn't engaged."

The "ignore currently-paying" posture is *current*, not permanent. Re-evaluate
after the new Build Room product is established and revenue is stable.

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

**Naming gotcha:** the cadence titled `Build Room · 10-day welcome` is
**misnamed**. Its trigger is `plan_yRLG1PNR7m8Yh`, which is actually the
**free AutomationFlow plan** ($0/$0, 18,954 memberships). So the cadence
auto-enrolls new free signups, not paid Build Room buyers. `docs/SYSTEM.md`
also describes it incorrectly. Possible secondary issue: the templates were
authored for paid Build Room buyers but ship to free signups — copy
audit recommended.

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
