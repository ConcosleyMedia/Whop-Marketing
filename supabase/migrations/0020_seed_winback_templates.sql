-- Migration 20 — Seed real copy for the Win-back · 60-day templates.
--
-- Issue: ConcosleyMedia/Whop-Marketing#7 (Pilot 1 — Paid-churned reactivation)
-- Voice source: BuildRoom_Email_Whitepaper.docx (v1, 2026-05-02)
-- Audience: Paid recurring churned cohort (~1,801 per CONTEXT.md). Users
--           who paid recurring at some point and cancelled. Distinct from
--           Lifetime AutomationFlow Pro buyers (~90) who get a bespoke
--           transition campaign per ADR-0001.
--
-- The 3 placeholder templates from migration 0015 are UPDATED in place so
-- the existing Win-back · 60-day cadence (id 22222222-…-e00000000001) keeps
-- referencing them via the same UUIDs without sequence_json changes.
--
-- Voice differs from Pilot 0 (Free silent):
--   • Free silent never paid → opens with story/credibility
--   • Paid-churned was a real customer → opens with acknowledgment.
--     Honest about the gap, no "we miss you" framing, no win-back discount,
--     no fake scarcity. The whole register is "you tried it, here's what
--     changed, here's the door — close it again if it's still wrong."
--
-- Cadence still needs trigger_config.segment_id wired and status flipped
-- to 'active' before it fires — that's a separate operator step
-- (acceptance criteria of #7).

UPDATE email_templates
SET
  name = 'Win-back · Day 0 (acknowledge)',
  description = 'Sent on segment entry (paid-churned 60+ days, still sendable). Opens by acknowledging they paid and stopped — no "we miss you," no apology theater. Frames the next two emails. No CTA.',
  suggested_subject = 'you used to be a customer',
  preview_text = 'i''m not going to pretend i didn''t notice',
  html = '<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1A1A1C;background:#F7F5F0;line-height:1.55"><p>You paid for one of my products at some point and then stopped.</p><p>I''m not going to pretend i didn''t notice or wrap it in a "we miss you" line. People cancel for real reasons. Maybe the thing didn''t fit. Maybe your priorities changed. Maybe i didn''t deliver on something. All three are valid.</p><p>This isn''t a re-onboarding email. It''s a check-in.</p><p>What i''m building now is different from what you bought before. Not radically different in genre — still about helping people ship — but the structure has changed enough that the version of you who cancelled would be looking at a different product.</p><p>Two more emails over the next two weeks. The first shows what''s actually different. The second offers a way back if you want it. Reply to either one if it''s easier.</p><p>Either way, thanks for the cycle you spent paying. That data point is part of why this thing exists at all.</p><p>— {{SENDER_NAME}}</p><p style="font-size:11px;color:#888;margin-top:48px"><a href="{$unsubscribe}" style="color:#888">Unsubscribe</a></p></body></html>'
WHERE id = '11111111-1111-1111-1111-e00000000001';

UPDATE email_templates
SET
  name = 'Win-back · Day 7 (what changed)',
  description = 'Sent 7 days after Day 0 if no re-purchase. Three concrete changes since they cancelled — mechanism named, price floor dropped, audience sharpened. No CTA; sets up Day 14.',
  suggested_subject = 'what changed since you left',
  preview_text = 'the part i think you''ll actually want to know',
  html = '<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1A1A1C;background:#F7F5F0;line-height:1.55"><p>The product you bought is not the product i''m running now.</p><p>Three things changed.</p><p>The mechanism got named. There''s a five-stage protocol called Vibe-to-Ship, and every blueprint, every weekly drop, every office-hour question gets sorted by stage. When you joined before, the value was "here''s a pile of useful things." Now the value is "here''s the right next thing for where you are."</p><p>The price floor dropped. Build Room is $9/mo. That wasn''t a number i could have offered before. It works because the format is leaner — daily small drops, weekly office hours, no live-cohort overhead.</p><p>The audience is sharper. The community is opt-in for builders working with Claude Code, Codex, Cursor — not "anyone interested in AI." The chat is moderated against the slop that broke every other community in this niche, including my last one.</p><p>If any of that closes the gap on what didn''t work for you the first time, the next email is a way back in.</p><p>— {{SENDER_NAME}}</p><p>P.S. If you cancelled because the format was wrong, this version is probably better suited. If you cancelled for life-circumstance reasons, sub when it makes sense.</p><p style="font-size:11px;color:#888;margin-top:48px"><a href="{$unsubscribe}" style="color:#888">Unsubscribe</a></p></body></html>'
WHERE id = '11111111-1111-1111-1111-e00000000002';

UPDATE email_templates
SET
  name = 'Win-back · Day 14 (door open)',
  description = 'Final touch. Same price as everyone else (no win-back discount), no countdown, no fake scarcity. Single CTA → Build Room. Closes by inviting honest cancellation feedback.',
  suggested_subject = '$9 if you want back in',
  preview_text = 'no pressure, no countdown, just the door',
  html = '<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1A1A1C;background:#F7F5F0;line-height:1.55"><p>Last email in this thread.</p><p>If anything in the last two emails landed, Build Room is here at $9/mo: <a href="{{WHOP_BUILDROOM_URL}}" style="color:#FF5B1F">{{WHOP_BUILDROOM_URL}}</a></p><p>A few things i want to be specific about.</p><p>There''s no win-back discount. Same price as everyone else. Pretending an old customer deserves a special rate is one of those marketing tropes that mostly insults the reader.</p><p>There''s no countdown. The link works tomorrow, next month, next year. Build Room isn''t going anywhere because i''m running it, not sourcing it.</p><p>There''s no "limited time" offer hiding under the next email. I told you the price is $9 and i meant it.</p><p>If now isn''t the right moment, that''s fine. I''ll check in once or twice a year if something genuinely changes — not enough to bug you, enough that you don''t have to remember on your own.</p><p>Thanks again for the time you spent paying for the older thing. It''s part of why this one exists.</p><p>— {{SENDER_NAME}}</p><p>P.S. Reply if you cancelled for a reason i should know. The unheard ones are the most useful kind.</p><p style="font-size:11px;color:#888;margin-top:48px"><a href="{$unsubscribe}" style="color:#888">Unsubscribe</a></p></body></html>'
WHERE id = '11111111-1111-1111-1111-e00000000003';
