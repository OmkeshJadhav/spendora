import { isIsoDate, monthParam, monthRange, parseMonthParam, type IsoDate } from "@/lib/dates";
import { PAYMENT_MODES } from "@/lib/constants";
import type { MonthKey, PaymentMode } from "@/types";

/**
 * Expense search, filters and month scope (specification sections 23 and 24).
 *
 * Filters travel in the query string, so a narrowed list is linkable, survives
 * a refresh and works without JavaScript: the filter bar is a plain GET form
 * and the month navigator is a pair of anchors. Values are read leniently — an
 * unrecognised one is dropped rather than rejected, because a query string is
 * not a form submission and a stale link should still show a list.
 *
 * Nothing here is a security boundary. Ids are only shape-checked; whether one
 * names a category or a member of *this* list's owner is settled by the query,
 * which is scoped and runs under RLS, so an id from somewhere else simply
 * matches nothing.
 */

/** Sentinel for "expenses with no category recorded". */
export const FILTER_UNCATEGORISED = "none";

/**
 * Longest search term accepted.
 *
 * Long enough for an item name and a phrase from a note, short enough that a
 * pathological query string cannot turn into a pathological `ILIKE`.
 */
export const SEARCH_MAX_LENGTH = 80;

export type ExpenseFilters = {
  /** Free text matched against item name and notes, or null for any. */
  search: string | null;
  /** A category id, `FILTER_UNCATEGORISED`, or null for any. */
  categoryId: string | null;
  /** A member's user id, or null for any. Group lists only. */
  paidBy: string | null;
  paymentMode: PaymentMode | null;
  /** Inclusive start of an explicit date range. */
  from: IsoDate | null;
  /** Inclusive end of an explicit date range. */
  to: IsoDate | null;
  /**
   * Calendar month in view, honoured only when neither range end is given.
   *
   * Two ways of saying "when" would otherwise contradict each other. The
   * explicit range wins because it is the more specific of the two, and the
   * filter bar submits `from`/`to` without a `month`, so choosing dates drops
   * the month rather than silently losing to it.
   */
  month: MonthKey | null;
};

export const EMPTY_FILTERS: ExpenseFilters = {
  search: null,
  categoryId: null,
  paidBy: null,
  paymentMode: null,
  from: null,
  to: null,
  month: null,
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ParamValue = string | string[] | undefined;

export type ExpenseSearchParams = {
  q?: ParamValue;
  category?: ParamValue;
  paidBy?: ParamValue;
  paymentMode?: ParamValue;
  from?: ParamValue;
  to?: ParamValue;
  month?: ParamValue;
};

function first(value: ParamValue): string | null {
  const raw = Array.isArray(value) ? value[0] : value;

  return raw && raw.length > 0 ? raw : null;
}

function uuidOrNull(value: string | null): string | null {
  return value && UUID_PATTERN.test(value) ? value : null;
}

function isoDateOrNull(value: string | null): IsoDate | null {
  return value && isIsoDate(value) ? value : null;
}

/** Trimmed, whitespace-collapsed and capped. Null when nothing is left. */
function searchTerm(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const cleaned = value.trim().replace(/\s+/g, " ").slice(0, SEARCH_MAX_LENGTH);

  return cleaned.length > 0 ? cleaned : null;
}

/** Reads filters from a page's search parameters. */
export function parseExpenseFilters(
  searchParams: ExpenseSearchParams,
): ExpenseFilters {
  const category = first(searchParams.category);
  const paymentMode = first(searchParams.paymentMode);
  const modes: readonly string[] = PAYMENT_MODES.map((mode) => mode.value);

  let from = isoDateOrNull(first(searchParams.from));
  let to = isoDateOrNull(first(searchParams.to));

  // A range typed backwards is a slip, not a request for nothing. Reading it
  // as the range it describes beats an empty list the person cannot explain.
  if (from && to && from > to) {
    [from, to] = [to, from];
  }

  return {
    search: searchTerm(first(searchParams.q)),
    categoryId:
      category === FILTER_UNCATEGORISED
        ? FILTER_UNCATEGORISED
        : uuidOrNull(category),
    paidBy: uuidOrNull(first(searchParams.paidBy)),
    paymentMode:
      paymentMode && modes.includes(paymentMode)
        ? (paymentMode as PaymentMode)
        : null,
    from,
    to,
    month: parseMonthParam(first(searchParams.month) ?? undefined),
  };
}

/** True when the list is narrowed in any way, including by month. */
export function hasActiveFilters(filters: ExpenseFilters): boolean {
  return Boolean(
    filters.search ||
      filters.categoryId ||
      filters.paidBy ||
      filters.paymentMode ||
      filters.from ||
      filters.to ||
      filters.month,
  );
}

/** True when something other than the time scope is narrowing the list. */
export function hasFieldFilters(filters: ExpenseFilters): boolean {
  return Boolean(
    filters.search ||
      filters.categoryId ||
      filters.paidBy ||
      filters.paymentMode,
  );
}

/** The month the list is scoped to, or null for a custom range or all time. */
export function monthScope(filters: ExpenseFilters): MonthKey | null {
  return filters.from || filters.to ? null : filters.month;
}

/**
 * The inclusive bounds the query should apply, from whichever control set them.
 *
 * Either end may stand alone: "everything since 1 April" is a range a person
 * reasonably asks for, and is not the same question as "April onwards, ending
 * whenever the data does".
 */
export function dateBounds(filters: ExpenseFilters): {
  start: IsoDate | null;
  end: IsoDate | null;
} {
  if (filters.from || filters.to) {
    return { start: filters.from, end: filters.to };
  }

  if (filters.month) {
    const { start, end } = monthRange(filters.month);

    return { start, end };
  }

  return { start: null, end: null };
}

/** The filters as query parameters, for building links that keep them. */
export function filterParams(filters: ExpenseFilters): Record<string, string> {
  const params: Record<string, string> = {};

  if (filters.search) params.q = filters.search;
  if (filters.categoryId) params.category = filters.categoryId;
  if (filters.paidBy) params.paidBy = filters.paidBy;
  if (filters.paymentMode) params.paymentMode = filters.paymentMode;

  if (filters.from) params.from = filters.from;
  if (filters.to) params.to = filters.to;
  if (!filters.from && !filters.to && filters.month) {
    params.month = monthParam(filters.month);
  }

  return params;
}

/**
 * The filters minus the time scope.
 *
 * The month navigator appends its own `month`, so it must not inherit the
 * range it is replacing — otherwise `from`/`to` would keep winning and the
 * arrows would appear to do nothing.
 */
export function filterParamsWithoutScope(
  filters: ExpenseFilters,
): Record<string, string> {
  return filterParams({ ...filters, from: null, to: null, month: null });
}

/** A path with parameters appended, omitting the `?` when there are none. */
export function withParams(
  basePath: string,
  params: Record<string, string>,
): string {
  const search = new URLSearchParams(params).toString();

  return search ? `${basePath}?${search}` : basePath;
}
