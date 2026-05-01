-- Migration 15 — Seed lifecycle cadences with placeholder templates.
--
-- Activates the new whop_event trigger + per-step exit_if primitives shipped
-- in commit 3e4c1bb. Three cadences seeded as drafts (operator activates
-- them after populating template HTML):
--
--   1. Cancel save        — fires on cancel_at_period_end=true, exits on un-cancel
--   2. Past-due rescue    — fires on payment.failed, exits on payment recovery
--   3. Win-back (60d)     — fires on segment_added, exits when user re-purchases
--
-- Templates ship with placeholder HTML — operator populates copy via /templates.
-- Deterministic UUIDs make the migration idempotent and let the cadence
-- sequence_json reference templates without runtime lookup.
--
-- See docs/AGENT_NEXT.md for the spec.

-- ──────────────────────────────────────────────────────────────────────
-- Placeholder template HTML (shared shell — operator overwrites)
-- ──────────────────────────────────────────────────────────────────────
--
-- All 9 templates use the same skeleton: paper background, dashed signal-
-- orange placeholder banner naming the cadence + step, the body the operator
-- replaces, and a MailerLite-native {$unsubscribe} footer. {{KEY}} variables
-- are documented inline; [Name] is MailerLite's first-name merge token.

INSERT INTO email_templates (id, name, description, labels, html, suggested_subject, preview_text)
VALUES
  -- Cancel-save · 3 placeholder templates
  (
    '11111111-1111-1111-1111-c00000000001'::uuid,
    'Cancel-save · Day 0 (immediate)',
    'Sent the moment a member toggles cancel_at_period_end=true. Acknowledge their decision, ask why, surface the path back.',
    ARRAY['cancel-save', 'lifecycle', 'day-00'],
    '<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1A1A1C;background:#F7F5F0"><div style="border:2px dashed #FF5B1F;padding:16px;margin-bottom:24px;background:#FFF4EE"><p style="margin:0 0 4px;font-family:''JetBrains Mono'',monospace;font-size:11px;letter-spacing:0.05em;color:#FF5B1F">PLACEHOLDER · CANCEL-SAVE · DAY 0</p><p style="margin:0;font-size:13px;color:#5C5C5E">Replace this body. Variables: {{WHOP_BUILDROOM_URL}}, {{SENDER_NAME}}. First-name merge: [Name].</p></div><p>Hey [Name],</p><p>(write Day 0 body here)</p><p>— {{SENDER_NAME}}</p><p style="font-size:11px;color:#888;margin-top:48px"><a href="{$unsubscribe}">Unsubscribe</a></p></body></html>',
    'PLACEHOLDER subject — Day 0 cancel-save',
    'PLACEHOLDER preview text'
  ),
  (
    '11111111-1111-1111-1111-c00000000002'::uuid,
    'Cancel-save · Day 2',
    'Sent 48h after Day 0 if the user hasn''t un-cancelled. Re-state the value, share a member moment, soft re-engage.',
    ARRAY['cancel-save', 'lifecycle', 'day-02'],
    '<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1A1A1C;background:#F7F5F0"><div style="border:2px dashed #FF5B1F;padding:16px;margin-bottom:24px;background:#FFF4EE"><p style="margin:0 0 4px;font-family:''JetBrains Mono'',monospace;font-size:11px;letter-spacing:0.05em;color:#FF5B1F">PLACEHOLDER · CANCEL-SAVE · DAY 2</p><p style="margin:0;font-size:13px;color:#5C5C5E">Replace this body. Variables: {{WHOP_BUILDROOM_URL}}, {{SENDER_NAME}}. First-name merge: [Name].</p></div><p>Hey [Name],</p><p>(write Day 2 body here)</p><p>— {{SENDER_NAME}}</p><p style="font-size:11px;color:#888;margin-top:48px"><a href="{$unsubscribe}">Unsubscribe</a></p></body></html>',
    'PLACEHOLDER subject — Day 2 cancel-save',
    'PLACEHOLDER preview text'
  ),
  (
    '11111111-1111-1111-1111-c00000000003'::uuid,
    'Cancel-save · Day 5 (last call)',
    'Final touch before access ends. Last-chance offer or graceful goodbye + door-open framing.',
    ARRAY['cancel-save', 'lifecycle', 'day-05'],
    '<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1A1A1C;background:#F7F5F0"><div style="border:2px dashed #FF5B1F;padding:16px;margin-bottom:24px;background:#FFF4EE"><p style="margin:0 0 4px;font-family:''JetBrains Mono'',monospace;font-size:11px;letter-spacing:0.05em;color:#FF5B1F">PLACEHOLDER · CANCEL-SAVE · DAY 5</p><p style="margin:0;font-size:13px;color:#5C5C5E">Replace this body. Variables: {{WHOP_BUILDROOM_URL}}, {{SENDER_NAME}}. First-name merge: [Name].</p></div><p>Hey [Name],</p><p>(write Day 5 body here)</p><p>— {{SENDER_NAME}}</p><p style="font-size:11px;color:#888;margin-top:48px"><a href="{$unsubscribe}">Unsubscribe</a></p></body></html>',
    'PLACEHOLDER subject — Day 5 cancel-save',
    'PLACEHOLDER preview text'
  ),

  -- Past-due rescue · 3 placeholder templates
  (
    '11111111-1111-1111-1111-d00000000001'::uuid,
    'Past-due rescue · Day 1',
    'Sent ~24h after payment.failed if the card hasn''t been updated. Soft "card had trouble" + update-payment link.',
    ARRAY['past-due', 'lifecycle', 'day-01'],
    '<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1A1A1C;background:#F7F5F0"><div style="border:2px dashed #FF5B1F;padding:16px;margin-bottom:24px;background:#FFF4EE"><p style="margin:0 0 4px;font-family:''JetBrains Mono'',monospace;font-size:11px;letter-spacing:0.05em;color:#FF5B1F">PLACEHOLDER · PAST-DUE · DAY 1</p><p style="margin:0;font-size:13px;color:#5C5C5E">Replace this body. Variables: {{WHOP_BUILDROOM_URL}}, {{SENDER_NAME}}. First-name merge: [Name].</p></div><p>Hey [Name],</p><p>(write Day 1 body here)</p><p>— {{SENDER_NAME}}</p><p style="font-size:11px;color:#888;margin-top:48px"><a href="{$unsubscribe}">Unsubscribe</a></p></body></html>',
    'PLACEHOLDER subject — Day 1 past-due',
    'PLACEHOLDER preview text'
  ),
  (
    '11111111-1111-1111-1111-d00000000002'::uuid,
    'Past-due rescue · Day 3',
    'Sent 72h after enrollment if still past_due. More direct: clarify what they''ll lose, link to billing.',
    ARRAY['past-due', 'lifecycle', 'day-03'],
    '<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1A1A1C;background:#F7F5F0"><div style="border:2px dashed #FF5B1F;padding:16px;margin-bottom:24px;background:#FFF4EE"><p style="margin:0 0 4px;font-family:''JetBrains Mono'',monospace;font-size:11px;letter-spacing:0.05em;color:#FF5B1F">PLACEHOLDER · PAST-DUE · DAY 3</p><p style="margin:0;font-size:13px;color:#5C5C5E">Replace this body. Variables: {{WHOP_BUILDROOM_URL}}, {{SENDER_NAME}}. First-name merge: [Name].</p></div><p>Hey [Name],</p><p>(write Day 3 body here)</p><p>— {{SENDER_NAME}}</p><p style="font-size:11px;color:#888;margin-top:48px"><a href="{$unsubscribe}">Unsubscribe</a></p></body></html>',
    'PLACEHOLDER subject — Day 3 past-due',
    'PLACEHOLDER preview text'
  ),
  (
    '11111111-1111-1111-1111-d00000000003'::uuid,
    'Past-due rescue · Day 7 (last attempt)',
    'Final automated attempt before the membership expires. Direct + helpful tone.',
    ARRAY['past-due', 'lifecycle', 'day-07'],
    '<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1A1A1C;background:#F7F5F0"><div style="border:2px dashed #FF5B1F;padding:16px;margin-bottom:24px;background:#FFF4EE"><p style="margin:0 0 4px;font-family:''JetBrains Mono'',monospace;font-size:11px;letter-spacing:0.05em;color:#FF5B1F">PLACEHOLDER · PAST-DUE · DAY 7</p><p style="margin:0;font-size:13px;color:#5C5C5E">Replace this body. Variables: {{WHOP_BUILDROOM_URL}}, {{SENDER_NAME}}. First-name merge: [Name].</p></div><p>Hey [Name],</p><p>(write Day 7 body here)</p><p>— {{SENDER_NAME}}</p><p style="font-size:11px;color:#888;margin-top:48px"><a href="{$unsubscribe}">Unsubscribe</a></p></body></html>',
    'PLACEHOLDER subject — Day 7 past-due',
    'PLACEHOLDER preview text'
  ),

  -- Win-back · 3 placeholder templates
  (
    '11111111-1111-1111-1111-e00000000001'::uuid,
    'Win-back · Day 0 (we miss you)',
    'Sent on segment entry (churned 60+ days, still sendable). Acknowledge time gap, soft re-introduction.',
    ARRAY['winback', 'lifecycle', 'day-00'],
    '<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1A1A1C;background:#F7F5F0"><div style="border:2px dashed #FF5B1F;padding:16px;margin-bottom:24px;background:#FFF4EE"><p style="margin:0 0 4px;font-family:''JetBrains Mono'',monospace;font-size:11px;letter-spacing:0.05em;color:#FF5B1F">PLACEHOLDER · WINBACK · DAY 0</p><p style="margin:0;font-size:13px;color:#5C5C5E">Replace this body. Variables: {{WHOP_BUILDROOM_URL}}, {{WHOP_FREE_URL}}, {{SENDER_NAME}}. First-name merge: [Name].</p></div><p>Hey [Name],</p><p>(write Day 0 body here)</p><p>— {{SENDER_NAME}}</p><p style="font-size:11px;color:#888;margin-top:48px"><a href="{$unsubscribe}">Unsubscribe</a></p></body></html>',
    'PLACEHOLDER subject — Day 0 winback',
    'PLACEHOLDER preview text'
  ),
  (
    '11111111-1111-1111-1111-e00000000002'::uuid,
    'Win-back · Day 7 (here''s what''s new)',
    'Sent 7 days later if no re-purchase. What''s changed since they left, lead with proof of evolution.',
    ARRAY['winback', 'lifecycle', 'day-07'],
    '<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1A1A1C;background:#F7F5F0"><div style="border:2px dashed #FF5B1F;padding:16px;margin-bottom:24px;background:#FFF4EE"><p style="margin:0 0 4px;font-family:''JetBrains Mono'',monospace;font-size:11px;letter-spacing:0.05em;color:#FF5B1F">PLACEHOLDER · WINBACK · DAY 7</p><p style="margin:0;font-size:13px;color:#5C5C5E">Replace this body. Variables: {{WHOP_BUILDROOM_URL}}, {{WHOP_FREE_URL}}, {{SENDER_NAME}}. First-name merge: [Name].</p></div><p>Hey [Name],</p><p>(write Day 7 body here)</p><p>— {{SENDER_NAME}}</p><p style="font-size:11px;color:#888;margin-top:48px"><a href="{$unsubscribe}">Unsubscribe</a></p></body></html>',
    'PLACEHOLDER subject — Day 7 winback',
    'PLACEHOLDER preview text'
  ),
  (
    '11111111-1111-1111-1111-e00000000003'::uuid,
    'Win-back · Day 14 (last touch)',
    'Final win-back touch — soft incentive or clean farewell with door-open framing.',
    ARRAY['winback', 'lifecycle', 'day-14'],
    '<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1A1A1C;background:#F7F5F0"><div style="border:2px dashed #FF5B1F;padding:16px;margin-bottom:24px;background:#FFF4EE"><p style="margin:0 0 4px;font-family:''JetBrains Mono'',monospace;font-size:11px;letter-spacing:0.05em;color:#FF5B1F">PLACEHOLDER · WINBACK · DAY 14</p><p style="margin:0;font-size:13px;color:#5C5C5E">Replace this body. Variables: {{WHOP_BUILDROOM_URL}}, {{WHOP_FREE_URL}}, {{SENDER_NAME}}. First-name merge: [Name].</p></div><p>Hey [Name],</p><p>(write Day 14 body here)</p><p>— {{SENDER_NAME}}</p><p style="font-size:11px;color:#888;margin-top:48px"><a href="{$unsubscribe}">Unsubscribe</a></p></body></html>',
    'PLACEHOLDER subject — Day 14 winback',
    'PLACEHOLDER preview text'
  )
ON CONFLICT (id) DO NOTHING;


-- ──────────────────────────────────────────────────────────────────────
-- Cadences — all start as draft. Operator activates after populating templates.
-- ──────────────────────────────────────────────────────────────────────

INSERT INTO cadences (id, name, description, trigger_type, trigger_config, sequence_json, status)
VALUES
  -- 1. Cancel-save
  (
    '22222222-2222-2222-2222-c00000000001'::uuid,
    'Cancel save · 3-touch save flow',
    'Fires when a member toggles cancel_at_period_end=true. Each step exits early if they un-cancel before the send.',
    'whop_event',
    jsonb_build_object(
      'event_types', jsonb_build_array('membership.cancel_at_period_end_changed'),
      'plan_ids', jsonb_build_array(),
      'payload_path', 'cancel_at_period_end',
      'payload_value', true
    ),
    jsonb_build_object(
      'version', 1,
      'steps', jsonb_build_array(
        jsonb_build_object(
          'type', 'send_email',
          'template_id', '11111111-1111-1111-1111-c00000000001',
          'delay_hours', 0,
          'exit_if', jsonb_build_object(
            'match', 'all',
            'rules', jsonb_build_array(
              jsonb_build_object('field', 'any_cancel_at_period_end', 'op', 'is_false')
            ),
            'reason', 'un-cancelled before Day 0'
          )
        ),
        jsonb_build_object(
          'type', 'send_email',
          'template_id', '11111111-1111-1111-1111-c00000000002',
          'delay_hours', 48,
          'exit_if', jsonb_build_object(
            'match', 'all',
            'rules', jsonb_build_array(
              jsonb_build_object('field', 'any_cancel_at_period_end', 'op', 'is_false')
            ),
            'reason', 'un-cancelled before Day 2'
          )
        ),
        jsonb_build_object(
          'type', 'send_email',
          'template_id', '11111111-1111-1111-1111-c00000000003',
          'delay_hours', 72,
          'exit_if', jsonb_build_object(
            'match', 'all',
            'rules', jsonb_build_array(
              jsonb_build_object('field', 'any_cancel_at_period_end', 'op', 'is_false')
            ),
            'reason', 'un-cancelled before Day 5'
          )
        )
      )
    ),
    'draft'
  ),

  -- 2. Past-due rescue
  (
    '22222222-2222-2222-2222-d00000000001'::uuid,
    'Past-due rescue · payment recovery',
    'Fires on payment.failed. Each step exits early if the user no longer has any past_due membership (card got fixed).',
    'whop_event',
    jsonb_build_object(
      'event_types', jsonb_build_array('payment.failed'),
      'plan_ids', jsonb_build_array()
    ),
    jsonb_build_object(
      'version', 1,
      'steps', jsonb_build_array(
        jsonb_build_object(
          'type', 'send_email',
          'template_id', '11111111-1111-1111-1111-d00000000001',
          'delay_hours', 24,
          'exit_if', jsonb_build_object(
            'match', 'all',
            'rules', jsonb_build_array(
              jsonb_build_object('field', 'any_past_due_membership', 'op', 'is_false')
            ),
            'reason', 'card recovered before Day 1'
          )
        ),
        jsonb_build_object(
          'type', 'send_email',
          'template_id', '11111111-1111-1111-1111-d00000000002',
          'delay_hours', 48,
          'exit_if', jsonb_build_object(
            'match', 'all',
            'rules', jsonb_build_array(
              jsonb_build_object('field', 'any_past_due_membership', 'op', 'is_false')
            ),
            'reason', 'card recovered before Day 3'
          )
        ),
        jsonb_build_object(
          'type', 'send_email',
          'template_id', '11111111-1111-1111-1111-d00000000003',
          'delay_hours', 96,
          'exit_if', jsonb_build_object(
            'match', 'all',
            'rules', jsonb_build_array(
              jsonb_build_object('field', 'any_past_due_membership', 'op', 'is_false')
            ),
            'reason', 'card recovered before Day 7'
          )
        )
      )
    ),
    'draft'
  ),

  -- 3. Win-back · uses placeholder segment_id. Operator must update
  --    trigger_config.segment_id to a real segment before activating.
  (
    '22222222-2222-2222-2222-e00000000001'::uuid,
    'Win-back · 60-day re-engagement',
    'Fires on segment entry. Operator must wire trigger_config.segment_id to a real segment (e.g. "churned 60-180d, still sendable") before activating. Each step exits if the user re-purchases (lifecycle_stage leaves churned).',
    'segment_added',
    jsonb_build_object(
      'segment_id', '00000000-0000-0000-0000-000000000000'
    ),
    jsonb_build_object(
      'version', 1,
      'steps', jsonb_build_array(
        jsonb_build_object(
          'type', 'send_email',
          'template_id', '11111111-1111-1111-1111-e00000000001',
          'delay_hours', 0,
          'exit_if', jsonb_build_object(
            'match', 'all',
            'rules', jsonb_build_array(
              jsonb_build_object('field', 'lifecycle_stage', 'op', 'neq', 'value', 'churned')
            ),
            'reason', 're-purchased before Day 0'
          )
        ),
        jsonb_build_object(
          'type', 'send_email',
          'template_id', '11111111-1111-1111-1111-e00000000002',
          'delay_hours', 168,
          'exit_if', jsonb_build_object(
            'match', 'all',
            'rules', jsonb_build_array(
              jsonb_build_object('field', 'lifecycle_stage', 'op', 'neq', 'value', 'churned')
            ),
            'reason', 're-purchased before Day 7'
          )
        ),
        jsonb_build_object(
          'type', 'send_email',
          'template_id', '11111111-1111-1111-1111-e00000000003',
          'delay_hours', 168,
          'exit_if', jsonb_build_object(
            'match', 'all',
            'rules', jsonb_build_array(
              jsonb_build_object('field', 'lifecycle_stage', 'op', 'neq', 'value', 'churned')
            ),
            'reason', 're-purchased before Day 14'
          )
        )
      )
    ),
    'draft'
  )
ON CONFLICT (id) DO NOTHING;
