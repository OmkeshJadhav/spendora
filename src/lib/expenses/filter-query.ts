import "server-only";

import {
  dateBounds,
  FILTER_UNCATEGORISED,
  type ExpenseFilters,
} from "@/lib/expenses/filters";

/**
 * Turning `ExpenseFilters` into PostgREST clauses.
 *
 * Kept apart from `filters.ts` so the parsing and link-building half stays a
 * pure module the filter bar can import, and apart from the two query modules
 * so a personal list and a group list narrow by exactly the same rules
 * (specification section 24). Only the owner of the rows differs, and that is
 * the caller's clause, not this one's.
 */

/**
 * A user's search term as a safe `ILIKE` pattern, quoted for PostgREST.
 *
 * Two escapes are happening, in this order, and both are needed:
 *
 *  1. PostgreSQL's. `%` and `_` are wildcards inside `LIKE`, and the default
 *     escape character is a backslash — so a literal `%` a person typed
 *     becomes `\%`, and their `\` becomes `\\`. Without this, searching for
 *     "50%" would quietly match everything containing "50".
 *
 *  2. PostgREST's. Its filter grammar separates `or(...)` operands with commas
 *     and would otherwise cut the term in half at the first one. Wrapping the
 *     value in double quotes makes commas, parentheses and dots literal;
 *     inside the quotes, `"` and `\` are themselves escaped with `\`.
 *
 * Step 2 doubling the backslashes step 1 introduced is deliberate: PostgREST
 * unescapes them back to one before PostgreSQL ever sees the pattern.
 */
function ilikePattern(search: string): string {
  const escaped = search
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");

  const quoted = `%${escaped}%`.replace(/["\\]/g, (char) => `\\${char}`);

  return `"${quoted}"`;
}

/**
 * The minimum of a PostgREST query builder this needs.
 *
 * Typed structurally rather than against `PostgrestFilterBuilder` because the
 * same clauses are applied to a page query, a count query and a sum query,
 * which have different generic parameters and would otherwise need three
 * signatures saying the same thing.
 */
type FilterableQuery<T> = {
  eq: (column: string, value: string) => T;
  is: (column: string, value: null) => T;
  gte: (column: string, value: string) => T;
  lte: (column: string, value: string) => T;
  or: (filters: string) => T;
};

/** Applies search, category, payer, payment mode and date bounds to a query. */
export function applyExpenseFilters<T extends FilterableQuery<T>>(
  query: T,
  filters: ExpenseFilters,
): T {
  let filtered = query;

  if (filters.search) {
    // Notes are part of what a person searches (specification section 24), so
    // a match in either column keeps the row.
    const pattern = ilikePattern(filters.search);

    filtered = filtered.or(
      `item_name.ilike.${pattern},notes.ilike.${pattern}`,
    );
  }

  if (filters.categoryId === FILTER_UNCATEGORISED) {
    filtered = filtered.is("category_id", null);
  } else if (filters.categoryId) {
    filtered = filtered.eq("category_id", filters.categoryId);
  }

  if (filters.paidBy) {
    filtered = filtered.eq("paid_by", filters.paidBy);
  }

  if (filters.paymentMode) {
    filtered = filtered.eq("payment_mode", filters.paymentMode);
  }

  // `expense_date` is a calendar date, so both ends are inclusive: there is no
  // "23:59:59.999" edge to miss the way there would be with a timestamp.
  const { start, end } = dateBounds(filters);

  if (start) {
    filtered = filtered.gte("expense_date", start);
  }

  if (end) {
    filtered = filtered.lte("expense_date", end);
  }

  return filtered;
}
