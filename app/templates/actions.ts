"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createCampaign,
  deleteCampaign,
  findOrCreateGroup,
  importSubscribers,
  scheduleCampaign,
  waitForImport,
} from "@/lib/mailerlite/client";
import { substituteVariables } from "@/lib/templates/variables";

function parseLabels(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0 && s.length <= 40)
    .filter((v, i, a) => a.indexOf(v) === i) // dedupe
    .slice(0, 20); // hard cap
}

function extractFields(fd: FormData) {
  const name = String(fd.get("name") ?? "").trim();
  const description = String(fd.get("description") ?? "").trim() || null;
  const html = String(fd.get("html") ?? "");
  const suggested_subject =
    String(fd.get("suggested_subject") ?? "").trim() || null;
  const preview_text = String(fd.get("preview_text") ?? "").trim() || null;
  const labels = parseLabels(String(fd.get("labels") ?? ""));
  return { name, description, html, suggested_subject, preview_text, labels };
}

function fail(path: string, message: string): never {
  const u = new URL(path, "http://placeholder");
  u.searchParams.set("error", message);
  redirect(u.pathname + "?" + u.searchParams.toString());
}

export async function createTemplateAction(formData: FormData) {
  const f = extractFields(formData);
  if (!f.name) fail("/templates/new", "Name is required.");
  if (!f.html.trim()) fail("/templates/new", "HTML body is required.");

  const db = createAdminClient();
  const { data, error } = await db
    .from("email_templates")
    .insert(f)
    .select("id")
    .single();

  if (error) fail("/templates/new", error.message);

  revalidatePath("/templates");
  redirect(`/templates/${data!.id}`);
}

export async function updateTemplateAction(id: string, formData: FormData) {
  const f = extractFields(formData);
  if (!f.name) fail(`/templates/${id}/edit`, "Name is required.");
  if (!f.html.trim()) fail(`/templates/${id}/edit`, "HTML body is required.");

  const db = createAdminClient();
  const { error } = await db
    .from("email_templates")
    .update({ ...f, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) fail(`/templates/${id}/edit`, error.message);

  revalidatePath("/templates");
  revalidatePath(`/templates/${id}`);
  redirect(`/templates/${id}`);
}

export async function deleteTemplateAction(id: string) {
  const db = createAdminClient();
  const { error } = await db.from("email_templates").delete().eq("id", id);
  if (error) fail(`/templates/${id}`, error.message);

  revalidatePath("/templates");
  redirect("/templates");
}

// Send a test render of a template to one or more recipient emails.
//
// MailerLite's public Connect API doesn't expose a campaign "test" action, so
// we do what MailerLite's own UI does under the hood: upsert the recipients
// into a dedicated test group, then schedule a real instant send to only that
// group. The campaign is saved in MailerLite as [TEST] so the operator can
// see it in their dashboard if they want.
//
// {{KEY}} variables are resolved from template_variables; {$unsubscribe} and
// other MailerLite-native tokens pass through untouched (our regex only
// matches UPPER_SNAKE_CASE inside double-braces).
export type TestSendResult =
  | { ok: true; sent_to: string[]; campaign_id?: string }
  | { ok: false; error: string };

const DEFAULT_FROM_NAME = "AutomationFlow";
const DEFAULT_FROM_EMAIL = "kevin@brnk.studio";
const TEST_GROUP_NAME = "CRM · Test Recipients";

export async function sendTestEmailAction(
  templateId: string,
  formData: FormData,
): Promise<TestSendResult> {
  const rawEmails = String(formData.get("recipients") ?? "")
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (rawEmails.length === 0) {
    return { ok: false, error: "At least one recipient email is required." };
  }
  if (rawEmails.length > 10) {
    return { ok: false, error: "Max 10 recipients per test send." };
  }
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const invalid = rawEmails.filter((e) => !emailPattern.test(e));
  if (invalid.length > 0) {
    return { ok: false, error: `Invalid email(s): ${invalid.join(", ")}` };
  }

  const db = createAdminClient();
  const [{ data: t, error: tErr }, { data: vRows }] = await Promise.all([
    db
      .from("email_templates")
      .select("id, name, html, suggested_subject")
      .eq("id", templateId)
      .single(),
    db.from("template_variables").select("key, value"),
  ]);
  if (tErr || !t) {
    return { ok: false, error: tErr?.message ?? "Template not found." };
  }
  const varMap = Object.fromEntries(
    ((vRows ?? []) as Array<{ key: string; value: string }>).map((v) => [
      v.key,
      v.value,
    ]),
  );

  const subject = substituteVariables(
    t.suggested_subject || t.name,
    varMap,
  );
  const content = substituteVariables(t.html as string, varMap);

  // 1. Find or create the dedicated test group.
  let testGroupId: string;
  try {
    const g = await findOrCreateGroup(TEST_GROUP_NAME);
    testGroupId = g.id;
  } catch (err) {
    return {
      ok: false,
      error: `Couldn't find/create test group: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 2. Upsert recipients into the test group (idempotent in MailerLite).
  try {
    const job = await importSubscribers(
      testGroupId,
      rawEmails.map((email) => ({ email })),
    );
    if (job.import_progress_url) {
      await waitForImport(job.import_progress_url, {
        intervalMs: 1000,
        timeoutMs: 30000,
      });
    }
  } catch (err) {
    return {
      ok: false,
      error: `Adding recipients to test group failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 3. Create a campaign targeting ONLY the test group, then schedule it
  // for instant delivery. This is a real send — only the test group gets it.
  let campaignId: string | null = null;
  try {
    const campaign = await createCampaign({
      name: `[TEST] ${t.name} · ${new Date().toISOString().slice(0, 16)}`,
      emails: [
        {
          subject: `[TEST] ${subject}`,
          from_name: DEFAULT_FROM_NAME,
          from: DEFAULT_FROM_EMAIL,
          content,
        },
      ],
      groups: [testGroupId],
    });
    campaignId = campaign.id;
    await scheduleCampaign(campaign.id, { delivery: "instant" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (campaignId) {
      // Best-effort: if schedule failed but campaign exists, delete the draft
      // so it doesn't linger. If the send already started, the delete will
      // fail — which is fine, we'll surface the error.
      try {
        await deleteCampaign(campaignId);
      } catch {
        /* ignore */
      }
    }
    return { ok: false, error: msg };
  }

  return { ok: true, sent_to: rawEmails, campaign_id: campaignId };
}
