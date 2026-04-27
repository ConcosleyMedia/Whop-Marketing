"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import { Braces, Save, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  extractTokens,
  findMissingTokens,
  substituteVariables,
  type VariableMap,
} from "@/lib/templates/variables";

export type TemplateEditorDefaults = {
  name?: string;
  description?: string | null;
  labels?: string[] | null;
  suggested_subject?: string | null;
  preview_text?: string | null;
  html?: string;
};

// Debounce HTML → iframe srcDoc updates so we don't reflow the preview on every
// keystroke. 200ms feels instant but batches rapid typing.
const PREVIEW_DEBOUNCE_MS = 200;

// Placeholders the 10 Build Room templates ship with look like [video-link] or
// [Name]. Capture anything wrapped in [...] that's made of words, dashes, dots,
// spaces — but NOT colons or attribute-style noise, so we don't catch random
// HTML like [style="..."] tokens. A placeholder must also be reasonably short.
const PLACEHOLDER_PATTERN = /\[([A-Za-z][\w \-.]{0,40})\]/g;

// Escape special regex characters when the user types a find string.
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function TemplateEditor({
  action,
  defaults,
  submitLabel,
  cancelHref,
  existingLabels,
  variables,
}: {
  action: (formData: FormData) => void | Promise<void>;
  defaults?: TemplateEditorDefaults;
  submitLabel: string;
  cancelHref: string;
  existingLabels?: string[];
  variables?: VariableMap;
}) {
  const varsMap = variables ?? {};
  const [html, setHtml] = useState(defaults?.html ?? "");
  const [previewHtml, setPreviewHtml] = useState(defaults?.html ?? "");
  const initialHtmlRef = useRef(defaults?.html ?? "");
  const [isDirty, setIsDirty] = useState(false);

  // Find/Replace state
  const [findOpen, setFindOpen] = useState(false);
  const [findValue, setFindValue] = useState("");
  const [replaceValue, setReplaceValue] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [lastReplaceCount, setLastReplaceCount] = useState<number | null>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setIsDirty(html !== initialHtmlRef.current);
    // The preview shows the rendered-with-variables version so the operator
    // sees real URLs as they type. The raw html (with {{TOKENS}} intact) is
    // what gets saved and stored — substitution happens again server-side
    // at campaign send.
    const resolved = substituteVariables(html, varsMap);
    const t = setTimeout(() => setPreviewHtml(resolved), PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [html, varsMap]);

  // Referenced tokens + any that are undefined (visible warning).
  const tokenRefs = useMemo(() => extractTokens(html), [html]);
  const missingTokens = useMemo(
    () => findMissingTokens(html, varsMap),
    [html, varsMap],
  );

  // Keyboard shortcut: Cmd/Ctrl-F opens the Find bar and focuses Find.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "f" || e.key === "F")) {
        // Only intercept when the user's focused inside our editor area.
        const focused = document.activeElement;
        const editorRoot = textareaRef.current?.closest("form");
        if (editorRoot && focused && editorRoot.contains(focused)) {
          e.preventDefault();
          setFindOpen(true);
          setTimeout(() => findInputRef.current?.select(), 0);
        }
      }
      if (e.key === "Escape" && findOpen) {
        setFindOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [findOpen]);

  // Count matches for the current find value (clamped to live html, not preview).
  const matchCount = useMemo(() => {
    if (!findValue) return 0;
    try {
      const re = new RegExp(
        escapeRegex(findValue),
        matchCase ? "g" : "gi",
      );
      return (html.match(re) ?? []).length;
    } catch {
      return 0;
    }
  }, [findValue, html, matchCase]);

  // Detect [placeholder] tokens in the current html. Sort by frequency desc,
  // then name asc. De-duplicate — same token appearing 3 times shows as one
  // chip with "(3)".
  const placeholders = useMemo(() => {
    const counts = new Map<string, number>();
    let m: RegExpExecArray | null;
    const re = new RegExp(PLACEHOLDER_PATTERN);
    while ((m = re.exec(html)) !== null) {
      const full = m[0];
      counts.set(full, (counts.get(full) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([token, count]) => ({ token, count }));
  }, [html]);

  const previewSize = useMemo(
    () => new Blob([previewHtml]).size,
    [previewHtml],
  );

  // One replace — swap the first occurrence matching the current search mode.
  const handleReplaceOne = useCallback(() => {
    if (!findValue) return;
    const re = new RegExp(escapeRegex(findValue), matchCase ? "" : "i");
    setHtml((prev) => {
      const match = prev.match(re);
      if (!match) return prev;
      const idx = prev.search(re);
      const next = prev.slice(0, idx) + replaceValue + prev.slice(idx + match[0].length);
      setLastReplaceCount(1);
      return next;
    });
  }, [findValue, replaceValue, matchCase]);

  const handleReplaceAll = useCallback(() => {
    if (!findValue) return;
    const re = new RegExp(escapeRegex(findValue), matchCase ? "g" : "gi");
    setHtml((prev) => {
      const matches = prev.match(re);
      const count = matches?.length ?? 0;
      if (count === 0) {
        setLastReplaceCount(0);
        return prev;
      }
      const next = prev.replace(re, replaceValue);
      setLastReplaceCount(count);
      return next;
    });
  }, [findValue, replaceValue, matchCase]);

  const openFindWith = useCallback((token: string) => {
    setFindValue(token);
    setReplaceValue("");
    setFindOpen(true);
    setLastReplaceCount(null);
    setTimeout(() => findInputRef.current?.select(), 0);
  }, []);

  // Enter inside Find = find next / focus textarea; Cmd-Enter = replace all.
  const onFindKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) handleReplaceAll();
    }
  };

  return (
    <form action={action} className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            name="name"
            required
            defaultValue={defaults?.name ?? ""}
            placeholder="e.g. Weekly recap"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="labels">Labels</Label>
          <Input
            id="labels"
            name="labels"
            defaultValue={(defaults?.labels ?? []).join(", ")}
            placeholder="comma, separated, tags"
          />
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="description">Description (optional)</Label>
        <Input
          id="description"
          name="description"
          defaultValue={defaults?.description ?? ""}
          placeholder="When to use this template"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="suggested_subject">Suggested subject</Label>
          <Input
            id="suggested_subject"
            name="suggested_subject"
            defaultValue={defaults?.suggested_subject ?? ""}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="preview_text">Preview text</Label>
          <Input
            id="preview_text"
            name="preview_text"
            defaultValue={defaults?.preview_text ?? ""}
          />
        </div>
      </div>

      {existingLabels && existingLabels.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <span>Existing labels:</span>
          {existingLabels.map((l) => (
            <span
              key={l}
              className="rounded-full bg-muted px-1.5 py-0.5 text-muted-foreground"
            >
              {l}
            </span>
          ))}
        </div>
      )}

      {/* Variables panel — {{KEY}} tokens */}
      {(Object.keys(varsMap).length > 0 || tokenRefs.length > 0) && (
        <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-wide text-blue-700 dark:text-blue-300">
            <Braces className="h-3 w-3" />
            Variables
            {tokenRefs.length > 0 && (
              <span className="rounded bg-blue-500/20 px-1 py-0.5 text-[10px] font-normal normal-case tracking-normal text-blue-800 dark:text-blue-200">
                {tokenRefs.length} referenced
              </span>
            )}
            {missingTokens.length > 0 && (
              <span className="rounded bg-destructive/20 px-1 py-0.5 text-[10px] font-normal normal-case tracking-normal text-destructive">
                {missingTokens.length} undefined
              </span>
            )}
            <span className="ml-auto text-[10px] font-normal normal-case tracking-normal text-muted-foreground">
              Click to copy · edit in{" "}
              <a
                href="/variables"
                className="underline hover:text-foreground"
              >
                /variables
              </a>
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Object.keys(varsMap)
              .sort()
              .map((key) => {
                const count =
                  tokenRefs.find((t) => t.key === key)?.count ?? 0;
                const token = `{{${key}}}`;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(token);
                    }}
                    title={`Click to copy · value: ${varsMap[key]}`}
                    className={
                      count > 0
                        ? "inline-flex items-center gap-1 rounded-md border border-blue-500/50 bg-white px-2 py-1 font-mono text-[11px] text-blue-800 hover:border-blue-600 hover:bg-blue-50 dark:bg-blue-950/20 dark:text-blue-200"
                        : "inline-flex items-center gap-1 rounded-md border border-blue-500/20 bg-white/50 px-2 py-1 font-mono text-[11px] text-blue-800/60 hover:border-blue-500/40 hover:bg-blue-50/70 dark:bg-blue-950/10"
                    }
                  >
                    <span>{token}</span>
                    {count > 0 && (
                      <span className="text-blue-600/70 tabular-nums">
                        ×{count}
                      </span>
                    )}
                  </button>
                );
              })}
            {missingTokens.map((key) => (
              <span
                key={`missing-${key}`}
                title="Referenced in HTML but not defined in /variables"
                className="inline-flex items-center gap-1 rounded-md border border-destructive/50 bg-white px-2 py-1 font-mono text-[11px] text-destructive"
              >
                <span>{`{{${key}}}`}</span>
                <span className="tabular-nums">undefined</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {placeholders.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
            Placeholders detected ({placeholders.length})
            <span className="ml-auto text-[10px] font-normal normal-case tracking-normal text-muted-foreground">
              Click a chip to pre-fill Find
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {placeholders.map(({ token, count }) => (
              <button
                key={token}
                type="button"
                onClick={() => openFindWith(token)}
                className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-white px-2 py-1 font-mono text-[11px] text-amber-800 hover:border-amber-600 hover:bg-amber-50 dark:bg-amber-950/20 dark:text-amber-200"
              >
                <span>{token}</span>
                <span className="text-amber-600/70 tabular-nums">×{count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="html">HTML body</Label>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <button
              type="button"
              onClick={() => {
                setFindOpen((v) => !v);
                if (!findOpen) setTimeout(() => findInputRef.current?.select(), 0);
              }}
              className="inline-flex items-center gap-1 rounded border border-input bg-background px-2 py-0.5 hover:bg-muted"
              title="Toggle Find/Replace (⌘F)"
            >
              <Search className="h-3 w-3" />
              Find / Replace
              <kbd className="ml-1 hidden rounded border bg-muted px-1 font-mono text-[10px] sm:inline">
                ⌘F
              </kbd>
            </button>
            <span className="tabular-nums">
              {html.length.toLocaleString()} chars ·{" "}
              {(previewSize / 1024).toFixed(1)}KB
            </span>
            <span
              className={
                isDirty
                  ? "inline-flex items-center gap-1 text-amber-600"
                  : "inline-flex items-center gap-1 text-green-600"
              }
            >
              <span
                className={
                  "inline-block h-1.5 w-1.5 rounded-full " +
                  (isDirty ? "bg-amber-500" : "bg-green-500")
                }
              />
              {isDirty ? "Unsaved changes" : "Saved"}
            </span>
          </div>
        </div>

        {findOpen && (
          <div className="rounded-md border bg-muted/30 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[12rem] flex-1">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={findInputRef}
                  value={findValue}
                  onChange={(e) => {
                    setFindValue(e.target.value);
                    setLastReplaceCount(null);
                  }}
                  onKeyDown={onFindKey}
                  placeholder="Find in HTML…"
                  className="h-8 pl-7 font-mono text-xs"
                />
                {findValue && (
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[10px] tabular-nums text-muted-foreground">
                    {matchCount}
                  </span>
                )}
              </div>
              <div className="min-w-[12rem] flex-1">
                <Input
                  value={replaceValue}
                  onChange={(e) => setReplaceValue(e.target.value)}
                  placeholder="Replace with… (e.g. https://whop.com/your-room)"
                  className="h-8 font-mono text-xs"
                />
              </div>
              <label className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={matchCase}
                  onChange={(e) => setMatchCase(e.target.checked)}
                />
                <span>Match case</span>
              </label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleReplaceOne}
                disabled={matchCount === 0}
                className="h-8 text-xs"
              >
                Replace
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleReplaceAll}
                disabled={matchCount === 0}
                className="h-8 gap-1 text-xs"
              >
                Replace all
                {matchCount > 0 && (
                  <span className="rounded bg-white/20 px-1 text-[10px] tabular-nums">
                    {matchCount}
                  </span>
                )}
              </Button>
              <button
                type="button"
                onClick={() => setFindOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Close Find"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {lastReplaceCount !== null && (
              <div className="mt-2 pl-1 text-[11px] text-muted-foreground">
                {lastReplaceCount === 0
                  ? "No matches — nothing replaced."
                  : `Replaced ${lastReplaceCount} occurrence${
                      lastReplaceCount === 1 ? "" : "s"
                    }.`}
              </div>
            )}
          </div>
        )}

        <div className="grid gap-3 lg:grid-cols-2">
          <textarea
            ref={textareaRef}
            id="html"
            name="html"
            required
            spellCheck={false}
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            className="min-h-[600px] w-full rounded-md border border-input bg-background p-3 font-mono text-[13px] leading-[1.55] outline-none focus:ring-1 focus:ring-ring lg:min-h-[720px]"
          />
          <div className="relative overflow-hidden rounded-md border bg-white">
            <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              <span>Live preview · 600px</span>
              <span className="font-mono normal-case tracking-normal">
                Sandboxed
              </span>
            </div>
            <iframe
              title="Template preview"
              srcDoc={previewHtml}
              sandbox=""
              className="h-[720px] w-full bg-white"
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Preview updates as you type ({PREVIEW_DEBOUNCE_MS}ms after you stop).
          MailerLite will send the same HTML; Outlook may render subtly
          differently — worth a test-send before any real campaign.
        </p>
      </div>

      <div className="flex items-center justify-between border-t pt-4">
        <Link
          href={cancelHref}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Cancel
        </Link>
        <Button type="submit" className="gap-1.5">
          <Save className="h-3.5 w-3.5" />
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
