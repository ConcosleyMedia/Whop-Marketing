"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type State =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; email: string }
  | { kind: "error"; message: string };

export default function LoginForm() {
  const searchParams = useSearchParams();
  const errorFromUrl = searchParams.get("error");
  const nextPath = searchParams.get("next") ?? "/";
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>(
    errorFromUrl ? { kind: "error", message: errorFromUrl } : { kind: "idle" },
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    setState({ kind: "sending" });
    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(
      nextPath,
    )}`;
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) {
      setState({ kind: "error", message: error.message });
      return;
    }
    setState({ kind: "sent", email: trimmed });
  }

  if (state.kind === "sent") {
    return (
      <div className="rounded-lg border bg-card p-4 text-center text-sm">
        <Mail className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
        <p>
          Magic link sent to <span className="font-medium">{state.email}</span>.
        </p>
        <p className="mt-1 text-muted-foreground">
          Click the link in your inbox to continue.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={state.kind === "sending"}
        />
      </div>
      {state.kind === "error" && (
        <p className="text-xs text-destructive">{state.message}</p>
      )}
      <Button
        type="submit"
        className="w-full"
        disabled={state.kind === "sending"}
      >
        {state.kind === "sending" ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Sending...
          </>
        ) : (
          "Send magic link"
        )}
      </Button>
    </form>
  );
}
