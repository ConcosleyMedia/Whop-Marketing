"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { enrollUserInCadence } from "@/lib/cadences/enroll";

function fail(path: string, msg: string): never {
  const u = new URL(path, "http://placeholder");
  u.searchParams.set("error", msg);
  redirect(u.pathname + "?" + u.searchParams.toString());
}

export async function setCadenceStatusAction(
  cadenceId: string,
  formData: FormData,
) {
  const status = String(formData.get("status") ?? "");
  if (!["active", "paused", "draft"].includes(status)) {
    fail(`/cadences/${cadenceId}`, `Invalid status: ${status}`);
  }
  const db = createAdminClient();
  const { error } = await db
    .from("cadences")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", cadenceId);
  if (error) fail(`/cadences/${cadenceId}`, error.message);

  revalidatePath("/cadences");
  revalidatePath(`/cadences/${cadenceId}`);
  redirect(`/cadences/${cadenceId}`);
}

export async function manualEnrollAction(
  cadenceId: string,
  formData: FormData,
) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) fail(`/cadences/${cadenceId}`, "Email is required.");

  const db = createAdminClient();
  const { data: user, error: uErr } = await db
    .from("users")
    .select("id, email")
    .ilike("email", email)
    .maybeSingle();
  if (uErr) fail(`/cadences/${cadenceId}`, uErr.message);
  if (!user) {
    fail(
      `/cadences/${cadenceId}`,
      `No user with email "${email}" — they need to exist in the CRM first (synced from Whop).`,
    );
  }

  const result = await enrollUserInCadence(db, cadenceId, user.id, {
    reason: "manual.enroll",
  });
  if (!result.ok) fail(`/cadences/${cadenceId}`, result.error);

  revalidatePath(`/cadences/${cadenceId}`);
  redirect(
    `/cadences/${cadenceId}?notice=${encodeURIComponent(
      result.created
        ? `Enrolled ${user.email}.`
        : `${user.email} was already enrolled — no change.`,
    )}`,
  );
}
