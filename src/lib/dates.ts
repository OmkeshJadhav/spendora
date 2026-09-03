import type { MonthKey } from "@/types";

/**
 * Calendar-date helpers.
 *
 * `expenses.expense_date` is a PostgreSQL `date`: a calendar day with no time
 * and no zone. Everything here therefore works on `YYYY-MM-DD` strings, and
 * never lets a `Date`'s UTC interpretation shift a day — `new Date("2026-09-10")`
 * is midnight UTC, which is still 9 September in the Americas. Dates are parsed
 * into local midnight instead, so "10 Sept 2026" always displays as itself.
 */

/** A calendar day in `YYYY-MM-DD` form, the shape PostgreSQL `date` uses. */
export type IsoDate = string;

/** Dates are shown as "10 Sept 2026" (specification section 7). */
const DATE_LOCALE = "en-GB";

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Earliest date an expense may carry — anything older is a typo. */
export const MIN_EXPENSE_DATE: IsoDate = "2000-01-01";

/** True only for a well-formed string that is also a real calendar day. */
export function isIsoDate(value: string): value is IsoDate {
  const match = ISO_DATE_PATTERN.exec(value);

  if (!match) {
    return false;
  }

  const [, year, month, day] = match.map(Number);
  const date = new Date(year, month - 1, day);

  // Rejects 31 February and friends, which Date would roll forward.
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

/** A `Date`'s local calendar day, as `YYYY-MM-DD`. Never uses UTC. */
export function toIsoDate(date: Date): IsoDate {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/** Today, in the calendar of whichever machine is asking. */
export function todayIso(): IsoDate {
  return toIsoDate(new Date());
}

/** `YYYY-MM-DD` as local midnight, so formatting cannot move it a day. */
export function parseIsoDate(value: IsoDate): Date {
  const [year, month, day] = value.split("-").map(Number);

  return new Date(year, month - 1, day);
}

/** "10 Sept 2026". */
export function formatExpenseDate(value: IsoDate): string {
  return new Intl.DateTimeFormat(DATE_LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(parseIsoDate(value));
}

/** "Today", "Yesterday", or the full date — used as list group headings. */
export function formatRelativeDate(value: IsoDate): string {
  const today = todayIso();

  if (value === today) {
    return "Today";
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  if (value === toIsoDate(yesterday)) {
    return "Yesterday";
  }

  return formatExpenseDate(value);
}

/** "September 2026". */
export function formatMonthLabel({ year, month }: MonthKey): string {
  return new Intl.DateTimeFormat(DATE_LOCALE, {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
}

/** The month a given calendar day falls in. */
export function monthKeyOf(value: IsoDate): MonthKey {
  const [year, month] = value.split("-").map(Number);

  return { year, month };
}

export function currentMonthKey(): MonthKey {
  return monthKeyOf(todayIso());
}

export function daysInMonth({ year, month }: MonthKey): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(year, month, 0).getDate();
}

/**
 * Inclusive `YYYY-MM-DD` bounds of a month, for range queries.
 *
 * Both ends are inclusive because `expense_date` is a date, not a timestamp:
 * there is no "23:59:59.999" edge to miss.
 */
export function monthRange(key: MonthKey): { start: IsoDate; end: IsoDate } {
  const { year, month } = key;

  return {
    start: toIsoDate(new Date(year, month - 1, 1)),
    end: toIsoDate(new Date(year, month - 1, daysInMonth(key))),
  };
}

/**
 * How many days of a month have happened, capped at its length.
 *
 * Average daily spending divides by this rather than by the month's length, so
 * a figure part-way through September is not diluted by days yet to come.
 */
export function elapsedDaysInMonth(key: MonthKey, today = todayIso()): number {
  const current = monthKeyOf(today);
  const length = daysInMonth(key);

  if (key.year !== current.year || key.month !== current.month) {
    // A past month is complete; a future one has not started.
    const isPast =
      key.year < current.year ||
      (key.year === current.year && key.month < current.month);

    return isPast ? length : 0;
  }

  return Math.min(parseIsoDate(today).getDate(), length);
}

/** The latest date an expense may be dated: a year of slack for planning. */
export function maxExpenseDate(today = todayIso()): IsoDate {
  const date = parseIsoDate(today);
  date.setFullYear(date.getFullYear() + 1);

  return toIsoDate(date);
}

/**
 * A stored `timestamptz` in the reader's own zone, e.g. "2 Sept 2026, 18:04".
 *
 * Unlike `expense_date`, a timestamp is a real instant, so it is converted
 * rather than treated as a calendar day.
 */
export function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(DATE_LOCALE, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

/**
 * A month as it travels in a URL: `2026-09`.
 *
 * Months move through query strings so a month-scoped page is linkable,
 * bookmarkable and navigable with plain anchors — no client state, and the
 * back button does the obvious thing.
 */
export function monthParam({ year, month }: MonthKey): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

const MONTH_PARAM_PATTERN = /^(\d{4})-(\d{2})$/;

/** Earliest month a budget or a month view may address. */
export const MIN_MONTH: MonthKey = monthKeyOf(MIN_EXPENSE_DATE);

/** Parses `2026-09`, or null for anything that is not a real month in range. */
export function parseMonthParam(value: string | undefined): MonthKey | null {
  if (!value) {
    return null;
  }

  const match = MONTH_PARAM_PATTERN.exec(value);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);

  if (month < 1 || month > 12) {
    return null;
  }

  const key = { year, month };

  // The same window expenses may fall in, so a month can never be shown that
  // no expense could belong to.
  if (compareMonths(key, MIN_MONTH) < 0 || compareMonths(key, maxMonth()) > 0) {
    return null;
  }

  return key;
}

/** Negative, zero or positive, like a comparator. */
export function compareMonths(a: MonthKey, b: MonthKey): number {
  return a.year !== b.year ? a.year - b.year : a.month - b.month;
}

/** The month `delta` months away — `-1` is the previous month. */
export function shiftMonth({ year, month }: MonthKey, delta: number): MonthKey {
  // Day 1 keeps this away from the 31st-of-a-30-day-month problem.
  const date = new Date(year, month - 1 + delta, 1);

  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

/** The latest month that may be viewed, matching `maxExpenseDate()`. */
export function maxMonth(today = todayIso()): MonthKey {
  return monthKeyOf(maxExpenseDate(today));
}

/** A month as `YYYY-MM-01`, the shape `budgets.period_month` stores. */
export function monthStartIso(key: MonthKey): IsoDate {
  return monthRange(key).start;
}

/** The month a page should show: the one asked for, or the current one. */
export function resolveMonth(value: string | undefined): MonthKey {
  return parseMonthParam(value) ?? currentMonthKey();
}
