/**
 * Presentation-only helpers.
 *
 * Rule M1: money is integer paise everywhere in code, the database and the API.
 * Conversion to rupees happens here and nowhere else, so a float can never
 * reach a total.
 */

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
});

/** 189900 → "₹1,899.00" */
export function formatINR(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return "—";
  return inr.format(paise / 100);
}

const dateTime = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  dateStyle: "medium",
  timeStyle: "medium",
});

/** The database stores ISO-8601 UTC; the dashboard reads IST. */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateTime.format(date);
}

/** "3 minutes ago" — used for lists where a wall clock is noise. */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (Number.isNaN(seconds)) return "—";
  if (seconds < 60) return "just now";
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["minute", 60],
    ["hour", 3600],
    ["day", 86400],
  ];
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (let i = units.length - 1; i >= 0; i -= 1) {
    const [unit, divisor] = units[i];
    if (Math.abs(seconds) >= divisor) return formatter.format(-Math.round(seconds / divisor), unit);
  }
  return formatter.format(-seconds, "second");
}

/** `category_allowlist` → "Category Allowlist" */
export function titleCase(snake: string): string {
  return snake.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
