// Template variable substitution. Tokens in HTML look like {{WHOP_BUILDROOM_URL}};
// keys are uppercase + underscore to keep them distinct from MailerLite merge
// fields like {$name} and from our old [bracketed] placeholders.
//
// This module has to work in both server components (campaign send, editor
// page) and the client (live preview). The pure helpers here take a pre-loaded
// variable map so callers can fetch once and apply many times.

const TOKEN_PATTERN = /\{\{\s*([A-Z][A-Z0-9_]*)\s*\}\}/g;

export type VariableMap = Record<string, string>;

/** Replace every {{KEY}} in html with the corresponding value. Unknown keys
 * are left in place so operators can see them and fix them — silently
 * stripping would hide bugs. */
export function substituteVariables(
  html: string,
  vars: VariableMap,
): string {
  return html.replace(TOKEN_PATTERN, (match, key: string) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match;
  });
}

/** All distinct {{KEY}} tokens referenced in the HTML, in order of first
 * appearance, with occurrence counts. */
export function extractTokens(
  html: string,
): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  const re = new RegExp(TOKEN_PATTERN);
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const k = m[1];
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, count]) => ({ key, count }));
}

/** Which referenced tokens have no matching variable defined. Useful for
 * warning operators before they send. */
export function findMissingTokens(
  html: string,
  vars: VariableMap,
): string[] {
  const referenced = new Set(extractTokens(html).map((t) => t.key));
  return [...referenced].filter((k) => !(k in vars));
}
