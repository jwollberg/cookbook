/**
 * Plan dates.
 *
 * Everything here works in LOCAL time and formats by hand. `toISOString()`
 * converts to UTC first, so for anyone west of Greenwich a date near midnight
 * comes back as the previous day — which would silently put Monday's dinner
 * on Sunday's shopping list.
 */

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** YYYY-MM-DD in local time. */
export function isoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Parse YYYY-MM-DD as a local date, not a UTC instant. */
export function fromIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Monday of the week containing `date`. */
export function startOfWeek(date: Date): Date {
  const day = date.getDay(); // 0 = Sunday
  const backToMonday = day === 0 ? 6 : day - 1;
  return addDays(date, -backToMonday);
}

/** Seven local ISO dates starting at `start`. */
export function weekDates(start: Date, length = 7): string[] {
  return Array.from({ length }, (_, i) => isoDate(addDays(start, i)));
}

/** "Mon 17 Aug" */
export function formatDayLabel(iso: string): string {
  const date = fromIso(iso);
  const month = date.toLocaleString(undefined, { month: "short" });
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${month}`;
}

/** "17–23 Aug" or "31 Aug – 6 Sep" when the range straddles a month. */
export function formatRange(isoStart: string, isoEnd: string): string {
  const a = fromIso(isoStart);
  const b = fromIso(isoEnd);
  const monthA = a.toLocaleString(undefined, { month: "short" });
  const monthB = b.toLocaleString(undefined, { month: "short" });
  if (monthA === monthB && a.getFullYear() === b.getFullYear()) {
    return `${a.getDate()}–${b.getDate()} ${monthB}`;
  }
  return `${a.getDate()} ${monthA} – ${b.getDate()} ${monthB}`;
}
