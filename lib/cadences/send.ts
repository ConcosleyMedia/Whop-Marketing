// Send a single cadence step to a single user via MailerLite.
//
// Strategy: each user gets a dedicated MailerLite group "crm-user-<userId>"
// containing only that subscriber. To send a cadence email we:
//   1. Ensure the user is in their dedicated group (idempotent import)
//   2. Create a campaign targeting just that group, with the resolved HTML
//   3. Schedule for instant delivery
//   4. Log a 'sent' email_event tagged with app_cadence_id so the frequency
//      cap excludes this from broadcast totals
//
// Per-user groups keep the send scoped without polluting other groups. They
// also persist across steps — the same group is reused for every step the
// user receives, so we don't churn groups.

import {
  createCampaign,
  findOrCreateGroup,
  scheduleCampaign,
  upsertSubscriberToGroup,
} from "@/lib/mailerlite/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { substituteVariables } from "@/lib/templates/variables";
import { writeActivity } from "@/lib/whop/upsert";

type Db = ReturnType<typeof createAdminClient>;

const DEFAULT_FROM_NAME = "AutomationFlow";
const DEFAULT_FROM_EMAIL = "kevin@brnk.studio";

export type CadenceSendInput = {
  cadence_id: string;
  enrollment_id: string;
  user_id: string;
  step_index: number;
  template_id: string;
};

export type CadenceSendResult = {
  ok: boolean;
  mailerlite_campaign_id?: string;
  error?: string;
};

export async function sendCadenceStep(
  db: Db,
  input: CadenceSendInput,
): Promise<CadenceSendResult> {
  // Resolve recipient + template + variables in parallel.
  const [
    { data: user, error: userErr },
    { data: template, error: tmplErr },
    { data: vRows },
  ] = await Promise.all([
    db
      .from("users")
      .select("id, email, name, whop_user_id")
      .eq("id", input.user_id)
      .single(),
    db
      .from("email_templates")
      .select("id, name, html, suggested_subject")
      .eq("id", input.template_id)
      .single(),
    db.from("template_variables").select("key, value"),
  ]);

  if (userErr || !user) {
    return { ok: false, error: `User lookup failed: ${userErr?.message ?? "not found"}` };
  }
  if (tmplErr || !template) {
    return {
      ok: false,
      error: `Template lookup failed: ${tmplErr?.message ?? "not found"}`,
    };
  }

  const varMap = Object.fromEntries(
    ((vRows ?? []) as Array<{ key: string; value: string }>).map((v) => [
      v.key,
      v.value,
    ]),
  );

  const subject = substituteVariables(
    template.suggested_subject || template.name,
    varMap,
  );
  const content = substituteVariables(template.html as string, varMap);

  // Dedicated per-user group keeps the campaign scoped to just this user.
  let groupId: string;
  try {
    const g = await findOrCreateGroup(`crm-user-${user.id}`);
    groupId = g.id;
  } catch (err) {
    return {
      ok: false,
      error: `Find/create user group failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Synchronous single-subscriber upsert + group assignment. Much faster than
  // the bulk import-subscribers pipeline (sub-second vs 30s+ on re-imports).
  // Idempotent: re-asserting an existing membership returns 200.
  try {
    await upsertSubscriberToGroup(user.email, groupId);
  } catch (err) {
    return {
      ok: false,
      error: `Subscriber upsert failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Create + schedule the campaign.
  let campaignId: string;
  try {
    const campaign = await createCampaign({
      name: `[CADENCE] ${template.name} → ${user.email} · step ${input.step_index + 1}`,
      emails: [
        {
          subject,
          from_name: DEFAULT_FROM_NAME,
          from: DEFAULT_FROM_EMAIL,
          content,
        },
      ],
      groups: [groupId],
    });
    campaignId = campaign.id;
    await scheduleCampaign(campaign.id, { delivery: "instant" });
  } catch (err) {
    return {
      ok: false,
      error: `MailerLite send failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Log the send into our own tables. email_events.app_cadence_id is the
  // hook the frequency-cap query uses to exclude cadence sends.
  const occurredAt = new Date().toISOString();
  const { data: emailRow, error: emailErr } = await db
    .from("email_events")
    .insert({
      user_id: input.user_id,
      event_type: "sent",
      mailerlite_campaign_id: campaignId,
      app_cadence_id: input.cadence_id,
      email_subject: subject,
      metadata: {
        cadence_enrollment_id: input.enrollment_id,
        cadence_step_index: input.step_index,
        template_id: input.template_id,
      },
      occurred_at: occurredAt,
    })
    .select("id")
    .single();
  if (emailErr) {
    // Send already happened — just record the issue so we don't double-send.
    return {
      ok: true,
      mailerlite_campaign_id: campaignId,
      error: `Sent OK but logging failed: ${emailErr.message}`,
    };
  }

  await writeActivity(db, {
    user_id: input.user_id,
    activity_type: "cadence.email_sent",
    title: `Cadence email sent · step ${input.step_index + 1}`,
    description: subject,
    related_entity_type: "email_event",
    related_entity_id: emailRow.id as string,
    metadata: {
      cadence_id: input.cadence_id,
      enrollment_id: input.enrollment_id,
      step_index: input.step_index,
      template_id: input.template_id,
      mailerlite_campaign_id: campaignId,
    },
    occurred_at: occurredAt,
  });

  return { ok: true, mailerlite_campaign_id: campaignId };
}
