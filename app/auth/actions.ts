"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function parseAllowlist(): string[] {
  const raw = process.env.ALLOWED_EMAILS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function fail(next: string, message: string): never {
  const u = new URL("/auth/login", "http://placeholder");
  u.searchParams.set("error", message);
  if (next) u.searchParams.set("next", next);
  redirect(u.pathname + "?" + u.searchParams.toString());
}

export async function signInWithPasswordAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");

  if (!email) fail(next, "Email is required.");
  if (!password) fail(next, "Password is required.");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data?.user) {
    fail(next, error?.message ?? "Could not sign in.");
  }

  const allow = parseAllowlist();
  const userEmail = data.user.email?.toLowerCase() ?? "";
  if (allow.length > 0 && !allow.includes(userEmail)) {
    await supabase.auth.signOut();
    fail(next, `${userEmail} is not allowed to sign in.`);
  }

  // Land on the requested next path, defaulting to home.
  redirect(next.startsWith("/") ? next : "/");
}
