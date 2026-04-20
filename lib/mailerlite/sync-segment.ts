import { createAdminClient } from "@/lib/supabase/admin";
import {
  findOrCreateGroup,
  importSubscribers,
  listGroupSubscribers,
  removeSubscriberFromGroup,
  waitForImport,
  type ImportSubscriber,
} from "./client";

const GROUP_PREFIX = "CRM: ";

export type SegmentSyncResult = {
  group_id: string;
  group_name: string;
  member_count: number;
  imported: number;
  processed: number;
  removed: number;
};

// Materialize a CRM segment into a MailerLite group named "CRM: <segment name>",
// reconciling both additions and removals. Runs in two passes:
//   1. Import the current segment members (idempotent — ML dedupes on email).
//   2. List the group's current subscribers and unassign any whose email is
//      no longer in the segment.
//
// Reconcile matters because CRM segments are re-evaluated on each save; without
// pass 2, the ML group drifts to a superset of the union of all past states.
export async function syncSegmentToMailerLiteGroup(
  segmentId: string,
): Promise<SegmentSyncResult> {
  const db = createAdminClient();

  const { data: segment, error: segErr } = await db
    .from("segments")
    .select("id, name")
    .eq("id", segmentId)
    .single();
  if (segErr || !segment) {
    throw new Error(segErr?.message ?? "Segment not found.");
  }

  const segmentEmails = await collectSegmentEmails(segmentId);
  if (segmentEmails.size === 0) {
    throw new Error(
      "Segment has no members to sync. Re-evaluate the segment first.",
    );
  }

  const group = await findOrCreateGroup(`${GROUP_PREFIX}${segment.name}`);

  // Pass 1 — import current segment members.
  let imported = 0;
  let processed = 0;
  const chunkSize = 1000;
  const emails = [...segmentEmails];
  for (let i = 0; i < emails.length; i += chunkSize) {
    const chunk = emails.slice(i, i + chunkSize);
    const subscribers: ImportSubscriber[] = chunk.map((email) => ({ email }));
    const job = await importSubscribers(group.id, subscribers);
    if (job.import_progress_url) {
      const final = await waitForImport(job.import_progress_url, {
        intervalMs: 3000,
        timeoutMs: 240000,
      });
      if (typeof final.imported === "number") imported += final.imported;
      if (typeof final.processed === "number") processed += final.processed;
    }
  }

  // Pass 2 — remove stale subscribers (in group but not in segment).
  const stale = await findStaleGroupMembers(group.id, segmentEmails);
  let removed = 0;
  for (const s of stale) {
    try {
      await removeSubscriberFromGroup(s.id, group.id);
      removed++;
    } catch {
      // Keep going — a single failed unassign shouldn't abort the whole reconcile.
    }
  }

  return {
    group_id: group.id,
    group_name: group.name,
    member_count: segmentEmails.size,
    imported,
    processed,
    removed,
  };
}

async function collectSegmentEmails(segmentId: string): Promise<Set<string>> {
  const db = createAdminClient();
  const pageSize = 1000;
  let offset = 0;
  const emails = new Set<string>();
  while (true) {
    const { data, error } = await db
      .from("segment_members")
      .select("users!inner(email)")
      .eq("segment_id", segmentId)
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`segment members fetch failed: ${error.message}`);
    const rows = (data ?? []) as unknown as Array<{
      users: { email: string | null } | null;
    }>;
    for (const r of rows) {
      const e = r.users?.email?.trim().toLowerCase();
      if (e) emails.add(e);
    }
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return emails;
}

async function findStaleGroupMembers(
  groupId: string,
  segmentEmails: Set<string>,
): Promise<Array<{ id: string; email: string }>> {
  const stale: Array<{ id: string; email: string }> = [];
  let cursor: string | undefined;
  while (true) {
    const page = await listGroupSubscribers(groupId, {
      limit: 1000,
      cursor,
    });
    for (const sub of page.subscribers) {
      const email = sub.email.trim().toLowerCase();
      if (!segmentEmails.has(email)) {
        stale.push({ id: sub.id, email });
      }
    }
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return stale;
}
