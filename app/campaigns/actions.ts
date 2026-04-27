"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteCampaign } from "@/lib/mailerlite/client";

// Delete a campaign in MailerLite and clean up our own campaigns row.
// MailerLite allows deleting draft, ready (scheduled), and canceled campaigns.
// Once a campaign is sending or finished, delete is rejected (we surface the
// error to the operator).
export async function deleteCampaignAction(campaignMailerliteId: string) {
  try {
    await deleteCampaign(campaignMailerliteId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const u = new URL("/campaigns", "http://placeholder");
    u.searchParams.set("error", `Delete failed: ${msg}`);
    redirect(u.pathname + "?" + u.searchParams.toString());
  }

  // Mirror the delete in our own campaigns table (if it was tracked there).
  const db = createAdminClient();
  await db
    .from("campaigns")
    .delete()
    .eq("mailerlite_campaign_id", campaignMailerliteId);

  revalidatePath("/campaigns");
  redirect("/campaigns");
}
