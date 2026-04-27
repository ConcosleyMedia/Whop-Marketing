import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Send } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createCampaign,
  deleteCampaign,
  listGroups,
  listSegments,
  scheduleCampaign,
  type ScheduleCampaignPayload,
} from "@/lib/mailerlite/client";
import {
  collectSegmentEmails,
  syncSegmentToMailerLiteGroup,
} from "@/lib/mailerlite/sync-segment";
import { findCappedEmails, getActiveCap } from "@/lib/frequency/check";
import { substituteVariables } from "@/lib/templates/variables";
import { TemplatePicker } from "./template-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DEFAULT_FROM_NAME = "AutomationFlow";
const DEFAULT_FROM_EMAIL = "kevin@brnk.studio";

async function createAndScheduleCampaign(formData: FormData) {
  "use server";

  const name = String(formData.get("name") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const fromName = String(formData.get("from_name") ?? "").trim();
  const fromEmail = String(formData.get("from_email") ?? "").trim();
  const replyTo = String(formData.get("reply_to") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  const audience = String(formData.get("audience") ?? "");
  const deliveryMode = String(formData.get("delivery") ?? "instant");
  const scheduleAtLocal = String(formData.get("schedule_at") ?? "");
  const templateId = String(formData.get("template_id") ?? "").trim() || null;

  const fail = (msg: string) => {
    const u = new URL("/campaigns/new", "http://placeholder");
    u.searchParams.set("error", msg);
    redirect(u.pathname + "?" + u.searchParams.toString());
  };

  if (!name) fail("Campaign name is required.");
  if (!subject) fail("Subject is required.");
  if (!fromName || !fromEmail) fail("From name and email are required.");
  if (!content) fail("Email body (HTML) is required.");
  if (!audience) fail("Pick a segment or group.");

  const [kind, audienceId] = audience.split(":");
  if (
    (kind !== "segment" && kind !== "group" && kind !== "crm") ||
    !audienceId
  ) {
    fail("Invalid audience selection.");
  }

  // CRM segments aren't first-class audiences in MailerLite — materialize
  // into a group named "CRM: <segment name>" first, then use that group id.
  // Frequency cap is enforced here (not for raw MailerLite audiences, where
  // we don't control who receives — MailerLite does).
  let mailerliteGroupId: string | null = null;
  let crmSegmentId: string | null = null;
  let capExcluded = 0;
  if (kind === "crm") {
    try {
      const db = createAdminClient();
      let excludeEmails = new Set<string>();
      const cap = await getActiveCap(db);
      if (cap) {
        const all = await collectSegmentEmails(audienceId);
        excludeEmails = await findCappedEmails(db, all, cap);
      }
      const sync = await syncSegmentToMailerLiteGroup(audienceId, {
        excludeEmails,
      });
      mailerliteGroupId = sync.group_id;
      crmSegmentId = audienceId;
      capExcluded = sync.excluded;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fail(`Segment sync failed: ${msg}`);
    }
  }

  let schedulePayload: ScheduleCampaignPayload;
  if (deliveryMode === "scheduled") {
    if (!scheduleAtLocal) fail("Pick a send time.");
    const dt = new Date(scheduleAtLocal);
    if (Number.isNaN(dt.getTime())) fail("Invalid send time.");
    if (dt.getTime() < Date.now() + 60_000) {
      fail("Scheduled time must be at least a minute in the future.");
    }
    const pad = (n: number) => String(n).padStart(2, "0");
    schedulePayload = {
      delivery: "scheduled",
      schedule: {
        date: `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`,
        hours: pad(dt.getUTCHours()),
        minutes: pad(dt.getUTCMinutes()),
      },
    };
  } else {
    schedulePayload = { delivery: "instant" };
  }

  // Resolve {{KEY}} tokens using the central variables table before the HTML
  // is handed to MailerLite. Tokens are kept as literal text in the template
  // library so the same template can be reused across multiple campaigns with
  // different variable values over time. Unknown keys are left as-is — the
  // editor's Variables panel surfaces them as "undefined" before send.
  const db = createAdminClient();
  const { data: varRows } = await db
    .from("template_variables")
    .select("key, value");
  const varMap = Object.fromEntries(
    ((varRows ?? []) as Array<{ key: string; value: string }>).map((v) => [
      v.key,
      v.value,
    ]),
  );
  const resolvedContent = substituteVariables(content, varMap);
  const resolvedSubject = substituteVariables(subject, varMap);

  let created: { id: string } | null = null;
  try {
    const campaign = await createCampaign({
      name,
      emails: [
        {
          subject: resolvedSubject,
          from_name: fromName,
          from: fromEmail,
          reply_to: replyTo || undefined,
          content: resolvedContent,
        },
      ],
      ...(kind === "segment"
        ? { segments: [audienceId] }
        : { groups: [kind === "crm" ? mailerliteGroupId! : audienceId] }),
    });
    created = { id: campaign.id };

    await scheduleCampaign(campaign.id, schedulePayload);
  } catch (err) {
    if (created?.id) {
      try {
        await deleteCampaign(created.id);
      } catch {
        // best-effort cleanup
      }
    }
    const msg = err instanceof Error ? err.message : String(err);
    fail(msg);
  }

  await db.from("campaigns").insert({
    name,
    subject: resolvedSubject,
    from_name: fromName,
    from_email: fromEmail,
    segment_id: crmSegmentId,
    mailerlite_campaign_id: created!.id,
    mailerlite_group_id:
      kind === "group" ? audienceId : mailerliteGroupId,
    status: deliveryMode === "scheduled" ? "scheduled" : "sending",
    scheduled_for:
      deliveryMode === "scheduled" && scheduleAtLocal
        ? new Date(scheduleAtLocal).toISOString()
        : null,
    cap_excluded_count: capExcluded,
    app_template_id: templateId,
  });

  redirect(`/campaigns/${created!.id}`);
}

export default async function NewCampaignPage(props: {
  searchParams: Promise<{ error?: string; segment?: string; template?: string }>;
}) {
  const sp = await props.searchParams;

  const db = createAdminClient();
  const [segments, groups, crmSegmentsRes, templatesRes, selectedTemplateRes] =
    await Promise.all([
      listSegments(),
      listGroups(),
      db
        .from("segments")
        .select("id, name, member_count")
        .order("name", { ascending: true }),
      db
        .from("email_templates")
        .select("id, name, labels, suggested_subject")
        .order("updated_at", { ascending: false }),
      sp.template
        ? db
            .from("email_templates")
            .select("id, name, html, suggested_subject, preview_text")
            .eq("id", sp.template)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
  const crmSegments = (crmSegmentsRes.data ?? []) as Array<{
    id: string;
    name: string;
    member_count: number | null;
  }>;
  const templates = (templatesRes.data ?? []) as Array<{
    id: string;
    name: string;
    labels: string[] | null;
    suggested_subject: string | null;
  }>;
  const selectedTemplate = selectedTemplateRes.data as {
    id: string;
    name: string;
    html: string;
    suggested_subject: string | null;
    preview_text: string | null;
  } | null;
  const sortedSegments = [...segments].sort(
    (a, b) => (b.total ?? 0) - (a.total ?? 0),
  );
  const sortedGroups = [...groups].sort(
    (a, b) => (b.active_count ?? 0) - (a.active_count ?? 0),
  );

  const defaultAudience = sp.segment
    ? `crm:${sp.segment}`
    : "";

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4">
        <Link
          href="/campaigns"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All campaigns
        </Link>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">New campaign</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Paste an HTML template, pick an audience, schedule or send. Pushes to
          MailerLite on submit.
        </p>
      </div>

      {sp.error && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {sp.error}
        </div>
      )}

      {/* key re-mounts the form when the selected template changes, so
          uncontrolled Input defaultValues (name/subject/html) initialize
          from the new template instead of keeping the prior values. */}
      <form
        key={selectedTemplate?.id ?? "blank"}
        action={createAndScheduleCampaign}
        className="space-y-5"
      >
        {templates.length > 0 && (
          <fieldset className="grid gap-2 rounded-md border bg-muted/20 p-4">
            <legend className="px-1 text-xs font-medium uppercase text-muted-foreground">
              Template
            </legend>
            {selectedTemplate ? (
              <div className="flex items-center justify-between gap-2 text-sm">
                <span>
                  Using{" "}
                  <Link
                    href={`/templates/${selectedTemplate.id}`}
                    className="font-medium hover:underline"
                  >
                    {selectedTemplate.name}
                  </Link>
                </span>
                <Link
                  href="/campaigns/new"
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Change / clear
                </Link>
              </div>
            ) : (
              <>
                <TemplatePicker
                  templates={templates}
                  preservedSegment={sp.segment ?? null}
                />
                <p className="text-xs text-muted-foreground">
                  Or leave blank and paste HTML below — both work.{" "}
                  <Link
                    href="/templates/new"
                    className="underline hover:text-foreground"
                  >
                    Create a new template
                  </Link>
                </p>
              </>
            )}
          </fieldset>
        )}
        <input
          type="hidden"
          name="template_id"
          value={selectedTemplate?.id ?? ""}
        />

        <div className="grid gap-2">
          <Label htmlFor="name">Internal name</Label>
          <Input
            id="name"
            name="name"
            required
            defaultValue={selectedTemplate?.name ?? ""}
            placeholder="e.g. Win-back churned Pro users · May 2026"
          />
          <p className="text-xs text-muted-foreground">
            Only you see this. MailerLite uses it to identify the campaign.
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="subject">Subject line</Label>
          <Input
            id="subject"
            name="subject"
            required
            defaultValue={selectedTemplate?.suggested_subject ?? ""}
            placeholder="Subject your subscribers will see"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="from_name">From name</Label>
            <Input
              id="from_name"
              name="from_name"
              required
              defaultValue={DEFAULT_FROM_NAME}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="from_email">From email</Label>
            <Input
              id="from_email"
              name="from_email"
              type="email"
              required
              defaultValue={DEFAULT_FROM_EMAIL}
            />
            <p className="text-xs text-muted-foreground">
              Must be a sender verified in MailerLite.
            </p>
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="reply_to">Reply-to (optional)</Label>
          <Input
            id="reply_to"
            name="reply_to"
            type="email"
            placeholder="support@yourdomain.com"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="audience">Audience</Label>
          <select
            id="audience"
            name="audience"
            required
            defaultValue={defaultAudience}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="" disabled>
              Select a segment or group
            </option>
            {crmSegments.length > 0 && (
              <optgroup label="CRM segments">
                {crmSegments.map((s) => (
                  <option key={s.id} value={`crm:${s.id}`}>
                    {s.name} ({(s.member_count ?? 0).toLocaleString()})
                  </option>
                ))}
              </optgroup>
            )}
            {sortedSegments.length > 0 && (
              <optgroup label="MailerLite segments">
                {sortedSegments.map((s) => (
                  <option key={s.id} value={`segment:${s.id}`}>
                    {s.name} ({(s.total ?? 0).toLocaleString()})
                  </option>
                ))}
              </optgroup>
            )}
            {sortedGroups.length > 0 && (
              <optgroup label="MailerLite groups">
                {sortedGroups.map((g) => (
                  <option key={g.id} value={`group:${g.id}`}>
                    {g.name} ({(g.active_count ?? 0).toLocaleString()})
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <p className="text-xs text-muted-foreground">
            CRM segments are synced to a &ldquo;CRM: &hellip;&rdquo; group in
            MailerLite on send.
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="content">HTML body</Label>
          <textarea
            id="content"
            name="content"
            required
            rows={14}
            defaultValue={selectedTemplate?.html ?? ""}
            placeholder="Paste the HTML generated by Claude design here..."
            className="rounded-md border border-input bg-background p-3 font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">
            If your HTML is missing an unsubscribe link, MailerLite appends its
            default footer automatically.
            {selectedTemplate && (
              <> Pre-filled from <span className="font-medium">{selectedTemplate.name}</span> — edit freely; the template stays unchanged.</>
            )}
          </p>
        </div>

        <fieldset className="grid gap-3 rounded-md border p-4">
          <legend className="px-1 text-xs font-medium uppercase text-muted-foreground">
            Delivery
          </legend>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="radio"
              name="delivery"
              value="instant"
              defaultChecked
              className="mt-1"
            />
            <span>
              <span className="font-medium">Send now</span>
              <span className="block text-xs text-muted-foreground">
                Push to MailerLite immediately. Starts within a few minutes.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="radio"
              name="delivery"
              value="scheduled"
              className="mt-1"
            />
            <span className="flex-1">
              <span className="font-medium">Schedule for later</span>
              <span className="mt-1 block">
                <Input
                  type="datetime-local"
                  name="schedule_at"
                  className="max-w-xs"
                />
              </span>
            </span>
          </label>
        </fieldset>

        <div className="flex items-center justify-between border-t pt-4">
          <Link
            href="/campaigns"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Link>
          <Button type="submit" className="gap-1.5">
            <Send className="h-3.5 w-3.5" />
            Create & schedule
          </Button>
        </div>
      </form>
    </main>
  );
}
