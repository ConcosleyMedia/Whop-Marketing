import Link from "next/link";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export async function Nav() {
  const authDisabled = process.env.DISABLE_AUTH === "true";
  let userEmail: string | null = null;

  if (!authDisabled) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    userEmail = user.email ?? null;
  }

  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          CRM
        </Link>
        <nav className="flex flex-1 items-center gap-4 text-sm text-muted-foreground">
          <Link href="/users" className="hover:text-foreground">
            Users
          </Link>
          <Link href="/segments" className="hover:text-foreground">
            Segments
          </Link>
          <Link href="/campaigns" className="hover:text-foreground">
            Campaigns
          </Link>
          <Link href="/cadences" className="hover:text-foreground">
            Cadences
          </Link>
          <Link href="/templates" className="hover:text-foreground">
            Templates
          </Link>
          <Link href="/variables" className="hover:text-foreground">
            Variables
          </Link>
          <Link href="/admin/health" className="hover:text-foreground">
            Health
          </Link>
        </nav>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {userEmail && (
            <span className="hidden sm:inline">{userEmail}</span>
          )}
          {!authDisabled && (
            <form action="/auth/logout" method="post">
              <button
                type="submit"
                className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-muted hover:text-foreground"
                aria-label="Sign out"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </button>
            </form>
          )}
        </div>
      </div>
    </header>
  );
}
