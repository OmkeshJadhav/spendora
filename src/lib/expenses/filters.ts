import { PAYMENT_MODES } from "@/lib/constants";
import type { PaymentMode } from "@/types";

/**
 * Group expense filters (specification section 24, the part Phase 6 covers).
 *
 * Filters travel in the query string, so the list is linkable, survives a
 * refresh and works without JavaScript: the filter bar is a plain GET form.
 * Values are read leniently — an unrecognised one is dropped rather than
 * rejected, because a query string is not a form submission and a stale link
 * should still show a list.
 */

/** Sentinel for "expenses with no category recorded". */
export const FILTER_UNCATEGORISED = "none";

export type ExpenseFilters = {
  /** A category id, `FILTER_UNCATEGORISED`, or null for any. */
  categoryId: string | null;
  /** A member's user id, or null for any. */
  paidBy: string | null;
  paymentMode: PaymentMode | null;
};

export const EMPTY_FILTERS: ExpenseFilters = {
  categoryId: null,
  paidBy: null,
  paymentMode: null,
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ParamValue = string | string[] | undefined;

function first(value: ParamValue): string | null {
  const raw = Array.isArray(value) ? value[0] : value;

  return raw && raw.length > 0 ? raw : null;
}

function uuidOrNull(value: string | null): string | null {
  return value && UUID_PATTERN.test(value) ? value : null;
}

/**
 * Reads filters from a page's search parameters.
 *
 * The ids are only shape-checked here. Whether they name a category or a
 * member of *this* group is settled by the query itself, which is scoped to
 * the group and runs under RLS — an id belonging to somewhere else simply
 * matches nothing.
 */
export function parseExpenseFilters(searchParams: {
  category?: ParamValue;
  paidBy?: ParamValue;
  paymentMode?: ParamValue;
}): ExpenseFilters {
  const category = first(searchParams.category);
  const paymentMode = first(searchParams.paymentMode);
  const modes: readonly string[] = PAYMENT_MODES.map((mode) => mode.value);

  return {
    categoryId:
      category === FILTER_UNCATEGORISED
        ? FILTER_UNCATEGORISED
        : uuidOrNull(category),
    paidBy: uuidOrNull(first(searchParams.paidBy)),
    paymentMode:
      paymentMode && modes.includes(paymentMode)
        ? (paymentMode as PaymentMode)
        : null,
  };
}

export function hasActiveFilters(filters: ExpenseFilters): boolean {
  return Boolean(filters.categoryId || filters.paidBy || filters.paymentMode);
}

/** The filters as query parameters, for building links that keep them. */
export function filterParams(filters: ExpenseFilters): Record<string, string> {
  const params: Record<string, string> = {};

  if (filters.categoryId) params.category = filters.categoryId;
  if (filters.paidBy) params.paidBy = filters.paidBy;
  if (filters.paymentMode) params.paymentMode = filters.paymentMode;

  return params;
}
