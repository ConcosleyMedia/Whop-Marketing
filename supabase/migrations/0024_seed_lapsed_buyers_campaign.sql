-- Migration 24 — Lapsed buyers campaign (4-touch over 14 days).
--
-- Targets the existing "Lapsed buyers" segment (id 9eedb211-…), which
-- as of 2026-05-07 holds 1,432 churned users with last_purchased_at >90
-- days ago. With the lifecycle fix from migration 0021, this cohort is
-- now correctly bounded to ex-customers who actually had access (canceled
-- or expired), not the misclassified completed=churned users.
--
-- Hook (operator-supplied): "your half-built app is making someone else
-- $50K/mo right now." Each email reinforces from a different angle:
--   Day 0  — narrative · the Lisbon competitor opened the wound
--   Day 4  — argument  · why he finished and you didn't (the kill habit)
--   Day 9  — explainer · the Kill Filter, calibrated against AI's bias
--   Day 14 — pitch     · Build Room $9/mo with honest expectation-setting
--
-- Voice notes (per ADR + operator feedback 2026-05-07): the 4 emails are
-- intentionally written in DIFFERENT shapes to avoid AI-speak sameness
-- — narrative, argument, explainer, pitch. No "what you don't get / what
-- you do get" pattern, no rhythmic three-beat lists, em-dashes ≤1 per
-- email, standard "I" capitalization, every email has at least one
-- specific detail (Lisbon, Figma, three test ideas, the math 50/4/<1).
--
-- exit_if uses match=any with two rules: lifecycle_stage left churned,
-- OR any_active_membership=true. Either signal = "they came back" =
-- stop pitching.
--
-- max_new_enrollments_per_run=178 stages the 1,432 over ~9 hourly ticks
-- if the operator activates aggressively, or operator can lower the cap
-- to slow it down further.
--
-- Status: draft. Operator render-tests the 4 templates and flips active.

-- ──────────────────────────────────────────────────────────────────────
-- 1. Templates
-- ──────────────────────────────────────────────────────────────────────

INSERT INTO email_templates (id, name, description, labels, html, suggested_subject, preview_text)
VALUES
  (
    '11111111-1111-1111-1111-a00000000001'::uuid,
    'Lapsed buyers · Day 0 (someone shipped it)',
    'Opens with the visceral hook — last week I scrolled past an ad for an app that does almost exactly what you tried to build, $50K/mo. Frames the next three emails. No CTA.',
    ARRAY['lapsed-buyers', 'reactivation', 'narrative', 'day-00'],
    '<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1A1A1C;background:#F7F5F0;line-height:1.55"><p>Last week I scrolled past an ad for an app that does almost exactly the thing you tried to build.</p><p>It''s making $50K a month. The founder is in his late 20s, built the whole thing in Cursor over a weekend in Lisbon. The execution is mediocre. The marketing is okay. The idea — the actual idea — is one you''ve been turning over for at least a year.</p><p>You paid for one of my products before, which is why this is short and direct.</p><p>Your idea was fine. Sometimes better. He finished and you didn''t.</p><p>Three more emails over the next two weeks. The next one is about why he finished, which is more specific than discipline. Then I''ll show you the thing I built to skip the part you keep getting stuck on. Then I''ll mention what''s available if you want it.</p><p>Thanks for the cycle you spent paying. The reason this product exists is to keep you from being on the wrong side of the next one of these stories.</p><p>— {{SENDER_NAME}}</p><p style="font-size:11px;color:#888;margin-top:48px"><a href="{$unsubscribe}" style="color:#888">Unsubscribe</a></p></body></html>',
    'someone shipped your idea',
    'and they''re charging $29/mo, which is real money compounding'
  ),

  (
    '11111111-1111-1111-1111-a00000000002'::uuid,
    'Lapsed buyers · Day 4 (it wasn''t discipline)',
    'The argument: he didn''t fall in love with his idea before testing it. You did. Stays killable on your own ideas. Setup for the Kill Filter email.',
    ARRAY['lapsed-buyers', 'reactivation', 'argument', 'day-04'],
    '<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1A1A1C;background:#F7F5F0;line-height:1.55"><p>The Lisbon guy who beat you to your idea didn''t have more discipline than you. He had less of one specific thing.</p><p>He didn''t fall in love with his idea before testing it.</p><p>You probably did. You sat with it. You sketched the homepage in Figma. You imagined the launch tweet. By the time you opened Cursor, you''d already invested enough belief in the idea that you couldn''t kill it when the first hard tradeoff showed up. Killing it would mean killing weeks of internal narrative.</p><p>He skipped that. He treated his three ideas like options on a menu. Tested them all in 72 hours, kept the one with the clearest paying buyer, killed the other two before they ate his focus.</p><p>He stayed killable on his own ideas long enough to only build the right one. That''s it.</p><p>The next email is the tool I built to do that — the same way he did it, except automated so it takes 4 minutes instead of 72 hours.</p><p>— {{SENDER_NAME}}</p><p>P.S. The "options on a menu" framing is from a member of mine who put it better than I have. Stealing it permanently.</p><p style="font-size:11px;color:#888;margin-top:48px"><a href="{$unsubscribe}" style="color:#888">Unsubscribe</a></p></body></html>',
    'it wasn''t discipline',
    'the thing he did that you don''t'
  ),

  (
    '11111111-1111-1111-1111-a00000000003'::uuid,
    'Lapsed buyers · Day 9 (the kill filter)',
    'Explainer: 5 criteria, biased toward kill (AI is biased toward yes). Survivors get 4 build files; deaths get one-line reason. Concrete demo with 3 ideas (lawyer chatbot, journal app, invoicing tool).',
    ARRAY['lapsed-buyers', 'reactivation', 'mechanism', 'day-09'],
    '<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1A1A1C;background:#F7F5F0;line-height:1.55"><p>The tool is called the Kill Filter.</p><p>It scores any idea against five criteria: paying proximity, build scope, validation cost, unfair advantage, retention shape. Most AI tools are biased toward yes; they''re trained to be encouraging. The Kill Filter is biased toward kill, calibrated against the failure rate I watched live for three years running my last community.</p><p>If your idea survives, it spits out four files: a CLAUDE.md, a one-page spec, a stack recommendation, and a cut-list of features that should NOT be in v1. You take those four files and start building. No more figuring out where to start.</p><p>If your idea doesn''t survive, you get a one-line reason and you move on. That single line saves you the 3-month death spiral where you build something for an audience that won''t pay.</p><p>I ran it on three ideas yesterday: an AI lawyer chatbot, an AI journal app, and an invoicing tool for freelance designers. The first two scored 30 and 32 out of 50. Killed. The invoicing one scored 86 — clear buyer, testable in 72 hours. That''s the one worth building.</p><p>The Kill Filter is in the free intro. The next email is what''s available beyond it.</p><p>— {{SENDER_NAME}}</p><p style="font-size:11px;color:#888;margin-top:48px"><a href="{$unsubscribe}" style="color:#888">Unsubscribe</a></p></body></html>',
    'the kill filter',
    'scores ideas, biased toward kill'
  ),

  (
    '11111111-1111-1111-1111-a00000000004'::uuid,
    'Lapsed buyers · Day 14 (build room is $9)',
    'Pitch with honest expectation-setting. The math (50/4/<1 per 1000 free signups). Same price as everyone else, no win-back discount. Single CTA → Build Room.',
    ARRAY['lapsed-buyers', 'reactivation', 'pitch', 'day-14'],
    '<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1A1A1C;background:#F7F5F0;line-height:1.55"><p>Build Room is $9/mo. <a href="{{WHOP_BUILDROOM_URL}}" style="color:#FF5B1F">{{WHOP_BUILDROOM_URL}}</a></p><p>If anything in the last three emails was you, the inside of Build Room is the same logic at higher density. The Kill Filter, the four build files it generates, daily small drops, weekly office hours, a private chat I run myself.</p><p>I want to be plain about a few things, because that''s the inheritance I owe you.</p><p>This isn''t going to make you a millionaire. The math says ~50 of every 1,000 free signups join Build Room, four make it to the cohort, less than one breaks meaningful revenue. You might not be the one. Most won''t be.</p><p>What it does do is fix the specific pattern that got you here: paying for tools, not shipping anything, watching mediocre versions of your ideas ship around you.</p><p>Same price as a new free signup. The link works tomorrow, next month, next year. There''s no countdown or win-back discount, because pretending old customers deserve a special rate insults the reader.</p><p>— {{SENDER_NAME}}</p><p>P.S. If you join and don''t ship in 30 days, that''s on me. Reply and tell me where you got stuck. I read every reply.</p><p style="font-size:11px;color:#888;margin-top:48px"><a href="{$unsubscribe}" style="color:#888">Unsubscribe</a></p></body></html>',
    'build room is $9',
    'and the math, plainly'
  )
ON CONFLICT (id) DO NOTHING;


-- ──────────────────────────────────────────────────────────────────────
-- 2. Cadence — wired to the existing "Lapsed buyers" segment
-- ──────────────────────────────────────────────────────────────────────

INSERT INTO cadences (
  id, name, description, trigger_type, trigger_config,
  sequence_json, status, max_new_enrollments_per_run
)
VALUES
  (
    '22222222-2222-2222-2222-a00000000001'::uuid,
    'Lapsed buyers · 4-touch ($50K hook)',
    'One-shot 4-email reactivation campaign for the Lapsed buyers segment (~1,432 churned ex-customers, 90+ days since last purchase). Hook: someone else is making $50K/mo with your idea. Status=draft until operator render-tests + activates. Caps at 178 enrollments/orchestrator-run for AUP safety.',
    'segment_added',
    jsonb_build_object(
      'segment_id', '9eedb211-da18-42e5-bea0-e10cec6d6b7a'
    ),
    jsonb_build_object(
      'version', 1,
      'steps', jsonb_build_array(
        -- Day 0 — narrative
        jsonb_build_object(
          'type', 'send_email',
          'template_id', '11111111-1111-1111-1111-a00000000001',
          'delay_hours', 0,
          'exit_if', jsonb_build_object(
            'match', 'any',
            'rules', jsonb_build_array(
              jsonb_build_object('field', 'lifecycle_stage', 'op', 'neq', 'value', 'churned'),
              jsonb_build_object('field', 'any_active_membership', 'op', 'is_true')
            ),
            'reason', 'returned before Day 0'
          )
        ),
        -- Day 4 — argument
        jsonb_build_object(
          'type', 'send_email',
          'template_id', '11111111-1111-1111-1111-a00000000002',
          'delay_hours', 96,
          'exit_if', jsonb_build_object(
            'match', 'any',
            'rules', jsonb_build_array(
              jsonb_build_object('field', 'lifecycle_stage', 'op', 'neq', 'value', 'churned'),
              jsonb_build_object('field', 'any_active_membership', 'op', 'is_true')
            ),
            'reason', 'returned before Day 4'
          )
        ),
        -- Day 9 — mechanism
        jsonb_build_object(
          'type', 'send_email',
          'template_id', '11111111-1111-1111-1111-a00000000003',
          'delay_hours', 120,
          'exit_if', jsonb_build_object(
            'match', 'any',
            'rules', jsonb_build_array(
              jsonb_build_object('field', 'lifecycle_stage', 'op', 'neq', 'value', 'churned'),
              jsonb_build_object('field', 'any_active_membership', 'op', 'is_true')
            ),
            'reason', 'returned before Day 9'
          )
        ),
        -- Day 14 — pitch
        jsonb_build_object(
          'type', 'send_email',
          'template_id', '11111111-1111-1111-1111-a00000000004',
          'delay_hours', 120,
          'exit_if', jsonb_build_object(
            'match', 'any',
            'rules', jsonb_build_array(
              jsonb_build_object('field', 'lifecycle_stage', 'op', 'neq', 'value', 'churned'),
              jsonb_build_object('field', 'any_active_membership', 'op', 'is_true')
            ),
            'reason', 'returned before Day 14'
          )
        )
      )
    ),
    'draft',
    178
  )
ON CONFLICT (id) DO NOTHING;
