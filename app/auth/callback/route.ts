import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function parseAllowlist(): string[] {
  const raw = process.env.ALLOWED_EMAILS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";

  if (!code) {
    const login = new URL("/auth/login", url.origin);
    login.searchParams.set("error", "Missing auth code. Try the link again.");
    return NextResponse.redirect(login);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data?.user) {
    const login = new URL("/auth/login", url.origin);
    login.searchParams.set(
      "error",
      error?.message ?? "Could not sign in. Request a new link.",
    );
    return NextResponse.redirect(login);
  }

  const allow = parseAllowlist();
  const email = data.user.email?.toLowerCase() ?? "";
  if (allow.length > 0 && !allow.includes(email)) {
    await supabase.auth.signOut();
    const login = new URL("/auth/login", url.origin);
    login.searchParams.set("error", `${email} is not allowed to sign in.`);
    return NextResponse.redirect(login);
  }

  const redirectTo = new URL(next.startsWith("/") ? next : "/", url.origin);
  return NextResponse.redirect(redirectTo);
}
