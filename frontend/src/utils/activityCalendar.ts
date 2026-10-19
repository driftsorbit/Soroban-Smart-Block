/**
 * Daily activity calendar buckets (#1040).
 *
 * Events are grouped by the UTC day of their ledger close time. Events without
 * a parseable `closed_at` cannot be placed on a day, so they are counted in
 * `undated` instead of being guessed.
 */

export const CALENDAR_RANGE_DAYS = [7, 30, 90] as const;
export type CalendarRangeDays = (typeof CALENDAR_RANGE_DAYS)[number];

export const DEFAULT_CALENDAR_RANGE: CalendarRangeDays = 30;

export interface CalendarEventInput {
  seq: number;
  closed_at?: string | null;
}

export interface CalendarDay {
  /** UTC date, YYYY-MM-DD. */
  date: string;
  count: number;
  /** Seq of the first event on this day, used as the link target. */
  firstSeq: number | null;
}

export interface ActivityCalendar {
  days: CalendarDay[];
  total: number;
  undated: number;
}

/** Narrow an untrusted range value to a supported one. */
export function sanitizeCalendarRange(value: unknown): CalendarRangeDays {
  return (CALENDAR_RANGE_DAYS as readonly unknown[]).includes(value)
    ? (value as CalendarRangeDays)
    : DEFAULT_CALENDAR_RANGE;
}

/** UTC calendar day for an ISO timestamp, or null if it does not parse. */
export function utcDayKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString().slice(0, 10);
}

/**
 * Build one entry per day for the last `rangeDays` days ending on `now`,
 * oldest first. Days without events are included with a zero count.
 */
export function buildActivityCalendar(
  events: CalendarEventInput[],
  rangeDays: number,
  now: Date = new Date(),
): ActivityCalendar {
  const days: CalendarDay[] = [];
  const indexByDate = new Map<string, number>();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let offset = rangeDays - 1; offset >= 0; offset--) {
    const date = new Date(today - offset * 86_400_000).toISOString().slice(0, 10);
    indexByDate.set(date, days.length);
    days.push({ date, count: 0, firstSeq: null });
  }

  let undated = 0;
  for (const ev of events) {
    const key = utcDayKey(ev.closed_at);
    if (key === null) {
      undated++;
      continue;
    }
    const idx = indexByDate.get(key);
    if (idx === undefined) continue;
    const day = days[idx];
    day.count++;
    if (day.firstSeq === null || ev.seq < day.firstSeq) day.firstSeq = ev.seq;
  }

  const total = days.reduce((sum, day) => sum + day.count, 0);
  return { days, total, undated };
}
