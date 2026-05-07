-- Migration 19 — Seed Pilot 0: Free silent reactivation campaign.
--
-- Issue: ConcosleyMedia/Whop-Marketing#3
-- Voice source: BuildRoom_Email_Whitepaper.docx (v1, 2026-05-02)
-- Audience: Free silent cohort (lifecycle=churned, total_ltv=0). ~15k users
--           who joined the free AutomationFlow Whop community and never
--           returned. See CONTEXT.md and docs/adr/0001 for cohort rationale.
--
-- This migration ships:
--   1. 4 reactivation email templates authored to whitepaper voice
--      (Day 0 Story → Day 3 Mirror → Day 7 Mechanism → Day 14 Pitch)
--   2. 1 "Free silent" dynamic segment (the broad ~15k cohort)
--   3. 1 cadence wiring the templates with delays 0/72/96/168 hours
--      and `exit_if: lifecycle_stage neq churned` on every step.
--
-- The cadence uses `trigger_type=manual` so the hourly orchestrator does
-- NOT auto-enroll the full cohort. Pilot 0 is a 400-user pilot with
-- ~100 enrollments/day for 4 days, manually staged via SQL — see
-- docs/runbooks/pilot0-free-silent.md. Status is `active` so the cadence
-- runner picks up enrollments the moment the operator inserts them.
--
-- Idempotent: deterministic UUIDs + ON CONFLICT DO NOTHING.

-- ──────────────────────────────────────────────────────────────────────
-- 1. Templates (4) — full HTML, real copy. No placeholder banners.
-- ──────────────────────────────────────────────────────────────────────
-- Voice rules from §05/§06 of the whitepaper enforced in copy:
--   • Subjects lowercase, 3–7 words, no emoji/brackets/hype
--   • First sentence is the hook, no greeting warm-up
--   • Banned phrases: unlock, leverage, 10x, game-changer, supercharge,
--     "the truth is", "in today's fast-paced world", etc.
--   • One CTA per email (Day 0/3/7 have zero — only Day 14 pitches)
--   • One em-dash per email max
--   • No buttons in early emails — plain hyperlinks
--   • [Name] is MailerLite's first-name merge; {{KEY}} are server-side
--     variables (template_variables table)

INSERT INTO email_templates (id, name, description, labels, html, suggested_subject, preview_text)
VALUES
  -- ────── Day 0 — Story (credibility / AutomationFlow failure) ──────
  (
    '11111111-1111-1111-1111-f00000000001'::uuid,
    'Pilot 0 · Free silent · Day 0 (story)',
    'Opens the 4-touch reactivation thread. AutomationFlow failure as credibility hook. No CTA — pure story to lower their guard.',
    ARRAY['pilot-0', 'free-silent', 'reactivation', 'story', 'day-00'],
    '<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1A1A1C;background:#F7F5F0;line-height:1.55"><p>A few years back i ran a community called AutomationFlow.</p><p>1,200 paying members at the peak. People shipping n8n workflows, sharing wins, helping each other. From the outside it looked like the thing every founder wants to build.</p><p>It still died.</p><p>Not because the tech changed. Not because n8n got worse. Because we sold tools and information instead of selling the discipline to ship. Members would join, get the blueprints, hoard them in a Notion doc, and disappear.</p><p>The community had everything except the only thing that mattered: a structure that made shipping the next week''s expectation, not the year-end goal.</p><p>I''m not telling you this so you''ll feel bad for me. I''m telling you because i watched it happen for three years before i admitted what was wrong, and almost everything in this niche has the same hole.</p><p>That''s the lesson behind what i''m building now. You''ll see it in the next few emails.</p><p>— {{SENDER_NAME}}</p><p>P.S. AutomationFlow taught me that bigger isn''t the goal. The next email is about you, not me.</p><p style="font-size:11px;color:#888;margin-top:48px"><a href="{$unsubscribe}" style="color:#888">Unsubscribe</a></p></body></html>',
    '1,200 members. still failed.',
    'the part nobody admits about online communities'
  ),

  -- ────── Day 3 — Mirror (problem — name the $200/mo stack) ──────
  (
    '11111111-1111-1111-1111-f00000000002'::uuid,
    'Pilot 0 · Free silent · Day 3 (mirror)',
    'Sent 72h after Day 0. Names the $200/mo AI tool stack and the gap between spend and shipped output. No CTA — converts hard because it feels like being seen, not sold.',
    ARRAY['pilot-0', 'free-silent', 'reactivation', 'mirror', 'day-03'],
    '<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1A1A1C;background:#F7F5F0;line-height:1.55"><p>Pull up your subscriptions list.</p><p>Claude $20. ChatGPT $20. Cursor $20. Lovable $25. Bolt $20. Maybe Replit, maybe Canva, maybe a Figma seat. Add them up and you''re north of $200/mo.</p><p>Now look at what''s actually live with your name on it.</p><p>For a lot of people on this list, that number is zero. For some it''s a half-built project that worked at 90% and broke at 10%. For nearly everyone it''s less than the spend justifies.</p><p>This isn''t a willpower problem. It''s a structure problem.</p><p>When every tool can do everything, the bottleneck moves from "can i build it" to "do i know what to build, will it matter, and will i finish before i pivot to the next shiny thing." None of those tools solve that. They make it worse. The same generative power that lets you start anything also lets you start everything.</p><p>The next email gets specific about what to do about it.</p><p>— {{SENDER_NAME}}</p><p>P.S. If your stack is leaner than that and you''re already shipping, ignore this thread. Most readers aren''t.</p><p style="font-size:11px;color:#888;margin-top:48px"><a href="{$unsubscribe}" style="color:#888">Unsubscribe</a></p></body></html>',
    '$200/mo, nothing shipped',
    'the stack you''re paying for says everything'
  ),

  -- ────── Day 7 — Mechanism (Vibe-to-Ship Protocol) ──────
  (
    '11111111-1111-1111-1111-f00000000003'::uuid,
    'Pilot 0 · Free silent · Day 7 (mechanism)',
    'Sent 96h after Day 3. Walks through the 5-stage Vibe-to-Ship Protocol — defined as much by what we cut as what we add. Soft pitch via mechanism education; no CTA.',
    ARRAY['pilot-0', 'free-silent', 'reactivation', 'mechanism', 'day-07'],
    '<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1A1A1C;background:#F7F5F0;line-height:1.55"><p>Most "build with AI" content tells you what to do.</p><p>The mechanism behind Build Room tells you what to ignore. It''s a five-stage protocol called Vibe-to-Ship, and each stage is defined as much by what we cut as what we add.</p><p style="font-family:''JetBrains Mono'',ui-monospace,monospace;font-size:13px;color:#FF5B1F;background:#FFF4EE;padding:12px 16px;border-radius:4px">01_IDEATE → 02_VALIDATE → 03_BLUEPRINT → 04_SHIP → 05_SELL</p><p>01 ideate isn''t "brainstorm everything." It''s "pick one idea you can defend in two sentences and kill the other four before they eat your week."</p><p>02 validate isn''t "build an MVP and see what happens." It''s find five people who would pay before you write a line of code.</p><p>03 blueprint isn''t "scaffold a SaaS template." It''s a 90-minute scope document that explicitly lists what''s not in v1.</p><p>04 ship isn''t "deploy." It''s a public deadline with a real audience watching.</p><p>05 sell isn''t "build in public." It''s a pricing page on a domain you bought, with a way to take money.</p><p>Notice what''s missing. No prompt engineering debates. No tool comparison videos. No "which AI to subscribe to next." Those questions die when the stages give you a place to put them.</p><p>That''s the whole product. Curation, not more.</p><p>— {{SENDER_NAME}}</p><p>P.S. The next email is the only one with a price in it.</p><p style="font-size:11px;color:#888;margin-top:48px"><a href="{$unsubscribe}" style="color:#888">Unsubscribe</a></p></body></html>',
    'what we tell you to ignore',
    'the curation matters more than the stages'
  ),

  -- ────── Day 14 — Pitch (Build Room $9/mo) ──────
  (
    '11111111-1111-1111-1111-f00000000004'::uuid,
    'Pilot 0 · Free silent · Day 14 (pitch)',
    'Final touch. Direct ask: Build Room $9/mo. Single CTA, single link, single price. Names what we do NOT promise. Plain hyperlink, no button.',
    ARRAY['pilot-0', 'free-silent', 'reactivation', 'pitch', 'day-14'],
    '<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1A1A1C;background:#F7F5F0;line-height:1.55"><p>Last email in this thread.</p><p>Build Room is the implementation of everything in the last three emails. $9/mo. One private chat. Daily drops. Weekly office hours. 50+ blueprints sized to ship, not to admire.</p><p>The price is deliberate. $9 is small enough that it''s not a financial decision. It''s a friction decision — a way to pay for the part of yourself that''s been on the sidelines and start showing up. If $9/mo is too much, the problem isn''t price.</p><p>What you get for it:</p><ul style="padding-left:20px;margin:0 0 16px"><li>The blueprint library, organized by Vibe-to-Ship stage</li><li>Daily small drops (a prompt, a workflow, a teardown)</li><li>Weekly office hours where i answer specific shipping questions, on camera</li><li>A private chat actively moderated against the slop that breaks every other community</li></ul><p>What you don''t get: testimonials we don''t have yet, fake outcome promises, fake scarcity. Build Room is new and i''d rather underclaim than rerun the AutomationFlow story.</p><p>If that sounds right: <a href="{{WHOP_BUILDROOM_URL}}" style="color:#FF5B1F">{{WHOP_BUILDROOM_URL}}</a></p><p>— {{SENDER_NAME}}</p><p>P.S. If you join and haven''t shipped in 30 days, that''s on me. Reply and tell me where you got stuck.</p><p style="font-size:11px;color:#888;margin-top:48px"><a href="{$unsubscribe}" style="color:#888">Unsubscribe</a></p></body></html>',
    '$9/mo. one room.',
    'the smallest commitment, and the only one that matters'
  )
ON CONFLICT (id) DO NOTHING;


-- ──────────────────────────────────────────────────────────────────────
-- 2. Segment — "Free silent" (broad cohort, ~15k)
-- ──────────────────────────────────────────────────────────────────────
-- Defines the full cohort. The 400-user pilot cap is applied at
-- enrollment time (see runbook), not in the segment definition, so the
-- same segment can be reused for issue #8 (full expansion to ~14,600).
--
-- Filter shape validated by lib/segments/schema.ts (FilterJsonSchema).

INSERT INTO segments (id, name, description, filter_json, is_dynamic, is_starter_template, member_count)
VALUES
  (
    '33333333-3333-3333-3333-f00000000001'::uuid,
    'Free silent',
    'Churned users with no lifetime spend — joined the free AutomationFlow Whop community, never returned. Primary nurture audience per docs/adr/0001-reactivation-audience-policy.md. Re-evaluated hourly by the orchestrator; member_count refreshes after the first eval run.',
    '{"match":"all","rules":[{"field":"lifecycle_stage","op":"eq","value":"churned"},{"field":"total_ltv","op":"lte","value":0}]}'::jsonb,
    true,
    false,
    0
  )
ON CONFLICT (id) DO NOTHING;


-- ──────────────────────────────────────────────────────────────────────
-- 3. Cadence — Pilot 0 (manual trigger, active, 4 steps)
-- ──────────────────────────────────────────────────────────────────────
-- Delays are step-relative (run.ts adds them to the previous send time):
--   Step 0 (Day 0):   0h   from enrollment
--   Step 1 (Day 3):  72h   after Day 0
--   Step 2 (Day 7):  96h   after Day 3
--   Step 3 (Day 14): 168h  after Day 7
--
-- Every step exits the enrollment if lifecycle_stage stops being
-- 'churned' — i.e. the user re-purchases or re-engages and gets
-- promoted to 'active'. No further sends after exit.

INSERT INTO cadences (
  id, name, description, trigger_type, trigger_config,
  sequence_json, status, max_new_enrollments_per_run
)
VALUES
  (
    '22222222-2222-2222-2222-f00000000001'::uuid,
    'Pilot 0 · Free silent reactivation (4-touch)',
    'Pilot reactivation campaign for the Free silent cohort. trigger_type=manual — operator stages ~100 enrollments/day for 4 days via runbook SQL (docs/runbooks/pilot0-free-silent.md). Active so the cadence runner sends as soon as enrollments are inserted. Each step exits if lifecycle_stage leaves "churned".',
    'manual',
    '{}'::jsonb,
    jsonb_build_object(
      'version', 1,
      'steps', jsonb_build_array(
        -- Day 0 — Story
        jsonb_build_object(
          'type', 'send_email',
          'template_id', '11111111-1111-1111-1111-f00000000001',
          'delay_hours', 0,
          'exit_if', jsonb_build_object(
            'match', 'all',
            'rules', jsonb_build_array(
              jsonb_build_object('field', 'lifecycle_stage', 'op', 'neq', 'value', 'churned')
            ),
            'reason', 'lifecycle changed before Day 0'
          )
        ),
        -- Day 3 — Mirror
        jsonb_build_object(
          'type', 'send_email',
          'template_id', '11111111-1111-1111-1111-f00000000002',
          'delay_hours', 72,
          'exit_if', jsonb_build_object(
            'match', 'all',
            'rules', jsonb_build_array(
              jsonb_build_object('field', 'lifecycle_stage', 'op', 'neq', 'value', 'churned')
            ),
            'reason', 'lifecycle changed before Day 3'
          )
        ),
        -- Day 7 — Mechanism
        jsonb_build_object(
          'type', 'send_email',
          'template_id', '11111111-1111-1111-1111-f00000000003',
          'delay_hours', 96,
          'exit_if', jsonb_build_object(
            'match', 'all',
            'rules', jsonb_build_array(
              jsonb_build_object('field', 'lifecycle_stage', 'op', 'neq', 'value', 'churned')
            ),
            'reason', 'lifecycle changed before Day 7'
          )
        ),
        -- Day 14 — Pitch
        jsonb_build_object(
          'type', 'send_email',
          'template_id', '11111111-1111-1111-1111-f00000000004',
          'delay_hours', 168,
          'exit_if', jsonb_build_object(
            'match', 'all',
            'rules', jsonb_build_array(
              jsonb_build_object('field', 'lifecycle_stage', 'op', 'neq', 'value', 'churned')
            ),
            'reason', 'lifecycle changed before Day 14'
          )
        )
      )
    ),
    'active',
    NULL
  )
ON CONFLICT (id) DO NOTHING;
