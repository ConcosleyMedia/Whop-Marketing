import { formatDistanceToNow, format as formatDateFns } from "date-fns";

export function formatMoney(
  amount: number | string | null | undefined,
  currency = "usd",
): string {
  if (amount == null) return "—";
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: n % 1 === 0 ? 0 : 2,
  }).format(n);
}

// MailerLite returns naive timestamps like "2026-04-24 17:07:53" with no
// timezone marker. `new Date(...)` parses those as LOCAL time, shifting by
// the operator's TZ offset — e.g. a US/Eastern user sees a UTC time as 4h
// in the future. Normalize by treating any naive date as UTC.
function toDate(d: string | Date): Date {
  if (d instanceof Date) return d;
  // Already ISO-8601 with TZ (contains 'T' + trailing Z/+/-): trust as-is.
  const hasTz = /T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(d);
  if (hasTz) return new Date(d);
  // "YYYY-MM-DD HH:MM:SS" (naive) → force UTC.
  const m = d.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/);
  if (m) return new Date(`${m[1]}T${m[2]}Z`);
  return new Date(d);
}

export function formatRelative(date: string | Date | null | undefined): string {
  if (!date) return "—";
  const d = toDate(date);
  if (Number.isNaN(d.getTime())) return "—";
  return formatDistanceToNow(d, { addSuffix: true });
}

export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return "—";
  const d = toDate(date);
  if (Number.isNaN(d.getTime())) return "—";
  return formatDateFns(d, "MMM d, yyyy 'at' h:mm a");
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "—";
  const d = toDate(date);
  if (Number.isNaN(d.getTime())) return "—";
  return formatDateFns(d, "MMM d, yyyy");
}
