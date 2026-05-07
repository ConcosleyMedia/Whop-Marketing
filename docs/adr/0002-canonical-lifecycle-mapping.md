# Canonical lifecycle mapping for Whop membership statuses

The original derivation classified users with status=`completed` as
`churned` and users whose only memberships were status=`drafted` (abandoned
signups) also as `churned`. This was technically aligned with the
"hasEverHadMembership" definition but wrong in operator terms: lifetime
buyers and free-community holders both land in `completed` and still have
access; drafted-only signups never were members at all. ~13,000 users
were misclassified, the original "Free silent ~15k" cohort was almost
entirely false positives, and Pilot 0's audience was unsendable as
designed (would have spammed people who were still in the community).

The canonical mapping (CONTEXT.md is the source of truth) is:

| Whop status                              | Effective access | Lifecycle  |
|------------------------------------------|------------------|------------|
| `active` / `trialing` (no cancel flag)   | yes              | active     |
| `completed`                              | yes (lifetimes, free community, one-time delivery) | active |
| `past_due`                               | yes (in grace)   | canceling  |
| `active`/`trialing` + cancel_at_period_end=true | yes (until period end) | canceling |
| `canceled` / `expired`                   | no               | churned    |
| `drafted` only (abandoned checkout)      | never            | prospect   |
| no memberships                           | n/a              | prospect   |

Hierarchy is active > canceling > churned > prospect — a user with
multiple memberships gets the highest applicable stage.

The mapping lives in three places that must stay in sync:
`lib/scoring/{compute,fetch}.ts` (lead-score engine, writes
`users.lifecycle_stage` on every webhook), `segment_eligibility_view`
(used by segments + cadence engine), and `user_marketing_view` (used by
the user-facing pages — dashboard, /users, /groups). The duplication is
known fragile; consolidating to a single source-of-truth view is on the
followup list.

`canceling` is a new stage; the segments enum in `lib/segments/schema.ts`
was widened to allow filtering on it, but no existing automations rely
on it yet — operator can author cancel-flow segments going forward.
