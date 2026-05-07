-- Migration 22 — Welcome backfill cadence (4-touch, 2-week).
--
-- Pivots the original Pilot 0 audience question. Of the 12,793 active free
-- AutomationFlow users with $0 LTV, ~12,556 signed up >30 days ago and
-- never received the 10-day welcome series (because the welcome cadence
-- was deployed after they joined). This cadence delivers a condensed
-- 4-email version of the welcome over 14 days — Day 0/4/9/14 from the
-- original Days 1/4/5/6 (the strongest of the 10).
--
-- Why segment_added + max_new_enrollments_per_run=178:
--   AUP-safe staging is non-negotiable per CONTEXT.md. 178/day × ~71 days
--   to clear the cohort. The hourly orchestrator handles enrollment;
--   operator activates by flipping status='active' (drafted here so we
--   can render-test before launching).
--
-- Why first_seen_at gt 30 days ago:
--   Recent free signups are auto-enrolled in the existing 10-day welcome
--   cadence (id 9bdb0f77-…) by webhook on membership.activated. Excluding
--   <30-day-old users prevents anyone from receiving both the full
--   welcome AND this backfill in parallel. Costs 237 users vs. the 12,793
--   raw cohort — a fair trade for the dedup.
--
-- exit_if total_ltv > 0: if a user buys Build Room mid-cycle, stop
-- pitching them. Day 14 is the offer, so this matters between steps.

-- ──────────────────────────────────────────────────────────────────────
-- 1. Segment — "Free signup welcome backfill"
-- ──────────────────────────────────────────────────────────────────────

INSERT INTO segments (id, name, description, filter_json, is_dynamic, is_starter_template, member_count)
VALUES
  (
    '33333333-3333-3333-3333-f00000000002'::uuid,
    'Free signup welcome backfill',
    'Active free AutomationFlow users who signed up >30 days ago and never paid. Cohort that joined the free community before the 10-day welcome cadence was deployed; gets a condensed 4-email welcome over 14 days. Hourly orchestrator stages 178 enrollments/run for AUP safety.',
    '{"match":"all","rules":[{"field":"lifecycle_stage","op":"eq","value":"active"},{"field":"total_ltv","op":"lte","value":0},{"field":"first_seen_at","op":"gt_days_ago","value":30}]}'::jsonb,
    true,
    false,
    0
  )
ON CONFLICT (id) DO NOTHING;


-- ──────────────────────────────────────────────────────────────────────
-- 2. Cadence — "Welcome backfill · 4-touch (2-week)"
-- ──────────────────────────────────────────────────────────────────────
-- Sequence references the existing welcome-series template UUIDs:
--   fb4795fd-b937-42ae-81fa-ba058ecf8942 → Day 01 Welcome (deliverable)
--   52cdb700-8e8a-4ce6-9965-bf77182f2200 → Day 04 $30 validation
--   2e17f9ff-890e-4736-9a2b-a295fc47243b → Day 05 CLAUDE.md (mechanism)
--   5d41395d-f97c-4aae-ae07-807dc56eeba7 → Day 06 The offer (pitch)
--
-- Delays (step-relative, per run.ts):
--   Step 0 (Day 0):   0h   from enrollment
--   Step 1 (Day 4):  96h   after Day 0 (4 days × 24h)
--   Step 2 (Day 9): 120h   after Day 4 (5 days × 24h)
--   Step 3 (Day 14):120h   after Day 9 (5 days × 24h)
-- Total: 336h = 14 days exactly.

INSERT INTO cadences (
  id, name, description, trigger_type, trigger_config,
  sequence_json, status, max_new_enrollments_per_run
)
VALUES
  (
    '22222222-2222-2222-2222-f00000000002'::uuid,
    'Welcome backfill · 4-touch (2-week)',
    'Condensed welcome series for the ~12,556 active free AutomationFlow users who joined before the 10-day welcome cadence existed. 4 emails over 14 days drawn from the strongest of the original 10. Status=draft until operator flips active. AUP-staged at 178 enrollments/orchestrator-run.',
    'segment_added',
    jsonb_build_object(
      'segment_id', '33333333-3333-3333-3333-f00000000002'
    ),
    jsonb_build_object(
      'version', 1,
      'steps', jsonb_build_array(
        jsonb_build_object(
          'type', 'send_email',
          'template_id', 'fb4795fd-b937-42ae-81fa-ba058ecf8942',
          'delay_hours', 0,
          'exit_if', jsonb_build_object(
            'match', 'all',
            'rules', jsonb_build_array(
              jsonb_build_object('field', 'total_ltv', 'op', 'gt', 'value', 0)
            ),
            'reason', 'purchased before Day 0'
          )
        ),
        jsonb_build_object(
          'type', 'send_email',
          'template_id', '52cdb700-8e8a-4ce6-9965-bf77182f2200',
          'delay_hours', 96,
          'exit_if', jsonb_build_object(
            'match', 'all',
            'rules', jsonb_build_array(
              jsonb_build_object('field', 'total_ltv', 'op', 'gt', 'value', 0)
            ),
            'reason', 'purchased before Day 4'
          )
        ),
        jsonb_build_object(
          'type', 'send_email',
          'template_id', '2e17f9ff-890e-4736-9a2b-a295fc47243b',
          'delay_hours', 120,
          'exit_if', jsonb_build_object(
            'match', 'all',
            'rules', jsonb_build_array(
              jsonb_build_object('field', 'total_ltv', 'op', 'gt', 'value', 0)
            ),
            'reason', 'purchased before Day 9'
          )
        ),
        jsonb_build_object(
          'type', 'send_email',
          'template_id', '5d41395d-f97c-4aae-ae07-807dc56eeba7',
          'delay_hours', 120,
          'exit_if', jsonb_build_object(
            'match', 'all',
            'rules', jsonb_build_array(
              jsonb_build_object('field', 'total_ltv', 'op', 'gt', 'value', 0)
            ),
            'reason', 'purchased before Day 14'
          )
        )
      )
    ),
    'draft',
    178
  )
ON CONFLICT (id) DO NOTHING;
