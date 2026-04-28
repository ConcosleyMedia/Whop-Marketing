"use client";

import { useSearchParams } from "next/navigation";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInWithPasswordAction } from "../actions";

export default function LoginForm() {
  const searchParams = useSearchParams();
  const errorFromUrl = searchParams.get("error");
  const nextPath = searchParams.get("next") ?? "/";

  return (
    <form action={signInWithPasswordAction} className="space-y-4">
      <input type="hidden" name="next" value={nextPath} />

      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>

      {errorFromUrl && (
        <p className="text-xs text-destructive">{errorFromUrl}</p>
      )}

      <Button type="submit" className="w-full gap-1.5">
        <Lock className="h-3.5 w-3.5" />
        Sign in
      </Button>
    </form>
  );
}
