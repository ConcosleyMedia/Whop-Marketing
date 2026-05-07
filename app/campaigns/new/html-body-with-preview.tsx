"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";

// Live split-pane editor: HTML textarea on the left (the source of truth that
// gets submitted with the form), rendered iframe on the right so the operator
// can see what subscribers will receive without leaving the page. Variable
// substitution ({{KEY}}) happens server-side at send time — preview just
// renders the raw HTML so MailerLite-native tokens like [Name] / {$unsubscribe}
// also pass through visibly.

export function HtmlBodyWithPreview({
  defaultValue,
  templateName,
}: {
  defaultValue: string;
  templateName: string | null;
}) {
  const [value, setValue] = useState(defaultValue);

  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor="content">HTML body</Label>
        <span className="text-[11px] text-muted-foreground">
          Source ↔ live preview
        </span>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <textarea
          id="content"
          name="content"
          required
          rows={20}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Paste HTML or pick from template library above…"
          className="rounded-md border border-input bg-background p-3 font-mono text-xs"
        />
        <div className="overflow-hidden rounded-md border bg-white">
          <iframe
            title="Email preview"
            srcDoc={value || "<p style=\"font-family:sans-serif;color:#888;padding:24px\">Preview will render here.</p>"}
            sandbox=""
            className="h-[480px] w-full"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        If your HTML is missing an unsubscribe link, MailerLite appends its
        default footer automatically.
        {templateName && (
          <>
            {" "}Pre-filled from <span className="font-medium">{templateName}</span> — edit freely; the template stays unchanged.
          </>
        )}
      </p>
    </div>
  );
}
