"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { evaluateSegment } from "@/lib/segments/evaluate";
import { FilterJsonSchema } from "@/lib/segments/schema";
import { syncSegmentToMailerLiteGroup } from "@/lib/mailerlite/sync-segment";

function failNew(msg: string): never {
  const u = new URL("/segments/new", "http://placeholder");
  u.searchParams.set("error", msg);
  redirect(u.pathname + "?" + u.searchParams.toString());
}

function failEdit(id: string, msg: string): never {
  const u = new URL(`/segments/${id}`, "http://placeholder");
  u.searchParams.set("error", msg);
  redirect(u.pathname + "?" + u.searchParams.toString());
}

export async function createSegmentAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const filterRaw = String(formData.get("filter_json") ?? "").trim();

  if (!name) failNew("Name is required.");
  if (!filterRaw) failNew("Filter is required.");

  let filter: unknown;
  try {
    filter = JSON.parse(filterRaw);
  } catch {
    failNew("Filter JSON is malformed.");
  }
  const parsed = FilterJsonSchema.safeParse(filter);
  if (!parsed.success) {
    failNew(parsed.error.issues.map((i) => i.message).join("; "));
  }

  const db = createAdminClient();
  const { data, error } = await db
    .from("segments")
    .insert({
      name,
      description,
      filter_json: parsed.data,
      is_dynamic: true,
    })
    .select("id")
    .single();
  if (error || !data) failNew(error?.message ?? "Insert failed.");

  try {
    await evaluateSegment(data.id, parsed.data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.from("segments").delete().eq("id", data.id);
    failNew(`Evaluation failed: ${msg}`);
  }

  revalidatePath("/segments");
  redirect(`/segments/${data.id}`);
}

export async function evaluateSegmentAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) failEdit(id, "Missing segment id.");

  const db = createAdminClient();
  const { data, error } = await db
    .from("segments")
    .select("filter_json")
    .eq("id", id)
    .single();
  if (error || !data) failEdit(id, error?.message ?? "Segment not found.");

  const parsed = FilterJsonSchema.safeParse(data.filter_json);
  if (!parsed.success) {
    failEdit(id, parsed.error.issues.map((i) => i.message).join("; "));
  }

  try {
    await evaluateSegment(id, parsed.data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failEdit(id, `Evaluation failed: ${msg}`);
  }

  revalidatePath(`/segments/${id}`);
  revalidatePath("/segments");
  redirect(`/segments/${id}`);
}

export async function syncSegmentToMailerLiteAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) failEdit(id, "Missing segment id.");

  let memberCount = 0;
  let removed = 0;
  try {
    const result = await syncSegmentToMailerLiteGroup(id);
    memberCount = result.member_count;
    removed = result.removed;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failEdit(id, `Sync failed: ${msg}`);
  }

  revalidatePath(`/segments/${id}`);
  const u = new URL(`/segments/${id}`, "http://placeholder");
  u.searchParams.set("synced", `${memberCount} synced · ${removed} removed`);
  redirect(u.pathname + "?" + u.searchParams.toString());
}

export async function deleteSegmentAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const db = createAdminClient();
  await db.from("segments").delete().eq("id", id);
  revalidatePath("/segments");
  redirect("/segments");
}
