"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

function normalizeKey(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 64);
}

function fail(message: string): never {
  const u = new URL("/variables", "http://placeholder");
  u.searchParams.set("error", message);
  redirect(u.pathname + "?" + u.searchParams.toString());
}

export async function createVariableAction(formData: FormData) {
  const key = normalizeKey(String(formData.get("key") ?? ""));
  const value = String(formData.get("value") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;

  if (!key) fail("Key is required.");
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
    fail("Key must start with a letter and contain only A–Z, 0–9, and underscore.");
  }
  if (!value) fail("Value is required.");

  const db = createAdminClient();
  const { error } = await db.from("template_variables").insert({
    key,
    value,
    description,
  });
  if (error) fail(error.code === "23505" ? `Key "${key}" already exists.` : error.message);

  revalidatePath("/variables");
  redirect("/variables");
}

export async function updateVariableAction(id: string, formData: FormData) {
  const value = String(formData.get("value") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;

  if (!value) fail("Value is required.");

  const db = createAdminClient();
  const { error } = await db
    .from("template_variables")
    .update({ value, description, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) fail(error.message);

  revalidatePath("/variables");
  revalidatePath("/templates");
  redirect("/variables");
}

export async function deleteVariableAction(id: string) {
  const db = createAdminClient();
  const { error } = await db.from("template_variables").delete().eq("id", id);
  if (error) fail(error.message);

  revalidatePath("/variables");
  redirect("/variables");
}
