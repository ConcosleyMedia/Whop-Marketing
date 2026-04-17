-- Migration 4 — Segments, campaigns, cadences

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

CREATE TABLE segment_members (
  segment_id UUID REFERENCES segments(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (segment_id, user_id)
);
CREATE INDEX idx_segment_members_user ON segment_members(user_id);

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
  status TEXT DEFAULT 'draft',
  scheduled_for TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
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

CREATE TABLE cadences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  mailerlite_automation_id TEXT,
  trigger_type TEXT NOT NULL,
  trigger_config JSONB NOT NULL,
  sequence_json JSONB NOT NULL,
  status TEXT DEFAULT 'draft',
  total_enrolled INT DEFAULT 0,
  total_completed INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE cadence_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cadence_id UUID REFERENCES cadences(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  current_step INT DEFAULT 0,
  status TEXT DEFAULT 'active',
  enrolled_at TIMESTAMPTZ DEFAULT NOW(),
  next_action_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  exit_reason TEXT,
  UNIQUE (cadence_id, user_id)
);
CREATE INDEX idx_cadence_enrollments_next_action
  ON cadence_enrollments(next_action_at)
  WHERE status = 'active';

ALTER TABLE email_events
  ADD CONSTRAINT fk_email_events_campaign
  FOREIGN KEY (app_campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL;
ALTER TABLE email_events
  ADD CONSTRAINT fk_email_events_cadence
  FOREIGN KEY (app_cadence_id) REFERENCES cadences(id) ON DELETE SET NULL;
