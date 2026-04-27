"use client";

import { useState, useTransition } from "react";
import { Mail, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TestSendResult } from "./actions";

export function SendTestForm({
  templateId,
  defaultRecipient,
  action,
}: {
  templateId: string;
  defaultRecipient: string;
  action: (templateId: string, formData: FormData) => Promise<TestSendResult>;
}) {
  const [open, setOpen] = useState(false);
  const [recipient, setRecipient] = useState(defaultRecipient);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<TestSendResult | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("recipients", recipient);
    setResult(null);
    startTransition(async () => {
      const r = await action(templateId, fd);
      setResult(r);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-muted"
      >
        <Mail className="h-3.5 w-3.5" />
        Send test
      </button>
    );
  }

  return (
    <div className="min-w-[320px] rounded-md border bg-background p-2 shadow-sm">
      <form onSubmit={submit} className="flex items-center gap-2">
        <Mail className="ml-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <Input
          type="text"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="you@example.com (comma-separate up to 10)"
          className="h-8 flex-1 text-xs"
          required
          disabled={pending}
        />
        <Button
          type="submit"
          size="sm"
          disabled={pending}
          className="h-8 gap-1 text-xs"
        >
          <Send className="h-3 w-3" />
          {pending ? "Sending…" : "Send"}
        </Button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setResult(null);
          }}
          className="text-xs text-muted-foreground hover:text-foreground"
          disabled={pending}
        >
          Cancel
        </button>
      </form>
      {result && (
        <div
          className={
            result.ok
              ? "mt-2 rounded border border-green-500/30 bg-green-500/10 px-2 py-1.5 text-[11px] text-green-700 dark:text-green-300"
              : "mt-2 rounded border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive"
          }
        >
          {result.ok ? (
            <>
              ✓ Test queued to <strong>{result.sent_to.join(", ")}</strong>.
              Inbox delivery typically 1–3 min.
              <span className="mt-1 block text-muted-foreground">
                Sent as a real campaign to the &ldquo;CRM · Test Recipients&rdquo;
                group in MailerLite
                {"campaign_id" in result && result.campaign_id
                  ? ` (campaign ${result.campaign_id}).`
                  : "."}
              </span>
            </>
          ) : (
            <>✗ {result.error}</>
          )}
        </div>
      )}
    </div>
  );
}
