import "server-only";

import { cache } from "react";

import { requireUser } from "@/lib/auth/dal";
import { applyExpenseFilters } from "@/lib/expenses/filter-query";
import { EMPTY_FILTERS, type ExpenseFilters } from "@/lib/expenses/filters";
import { isUuid } from "@/lib/ids";
import { sumAmounts } from "@/lib/money";
import { readAllRows } from "@/lib/supabase/paged";
import { createClient } from "@/lib/supabase/server";
import type { Category, Expense } from "@/types";

/**
 * Reads of the signed-in user's personal expenses.
 *
 * Every query filters on `user_id` and `group_id is null` even though RLS
 * already restricts the rows. The filters are not the security boundary — they
 * state the intent at the call site and let PostgreSQL use the partial index
 * built for exactly this path.
 */

export const EXPENSES_PER_PAGE = 20;

export type ExpenseCategory = Pick<Category, "id" | "name" | "is_archived">;

/** An expense with its category resolved for display. */
export type PersonalExpense = Expense & { category: ExpenseCategory | null };

/** Columns every expense read selects. Listed once so they cannot drift. */
const EXPENSE_COLUMNS =
  "id, user_id, group_id, paid_by, category_id, personal_owner_id, item_name, amount, currency_code, expense_date, payment_mode, notes, created_at, updated_at";

function failed(context: string, message: string): never {
  // Detail stays server-side; the error boundary shows friendly copy.
  console.error(`[expenses:${context}]`, message);
  throw new Error("We couldn't load your expenses. Please try again.");
}

/**
 * The user's own categories, newest names last.
 *
 * Categories are fetched separately rather than embedded in the expense query:
 * `expenses` has two foreign keys to `categories` (one for group rows, one for
 * personal), which makes a PostgREST embed ambiguous. One small extra query is
 * clearer than disambiguating a composite relationship by constraint name.
 */
export const listPersonalCategories = cache(
  async (): Promise<ExpenseCategory[]> => {
    const user = await requireUser();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("categories")
      .select("id, name, is_archived")
      .eq("user_id", user.id)
      .order("name", { ascending: true });

    if (error) {
      failed("listCategories", error.message);
    }

    return data ?? [];
  },
);

function attachCategories(
  expenses: Expense[],
  categories: ExpenseCategory[],
): PersonalExpense[] {
  const byId = new Map(categories.map((category) => [category.id, category]));

  return expenses.map((expense) => ({
    ...expense,
    category: expense.category_id ? (byId.get(expense.category_id) ?? null) : null,
  }));
}

export type ExpensePage = {
  expenses: PersonalExpense[];
  total: number;
  page: number;
  pageCount: number;
  /** Total of the rows the filters match, in minor units. */
  filteredTotal: number;
};

/**
 * One page of personal expenses, newest first.
 *
 * The search, filters and month scope are the same ones a group list uses
 * (specification section 24) — `applyExpenseFilters` is shared, so the two
 * lists cannot come to disagree about what "paid by cash in September" means.
 * Only the owning clause differs, and it is stated here.
 */
export async function listPersonalExpenses({
  page = 1,
  filters = EMPTY_FILTERS,
}: { page?: number; filters?: ExpenseFilters } = {}): Promise<ExpensePage> {
  const user = await requireUser();
  const supabase = await createClient();

  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const from = (safePage - 1) * EXPENSES_PER_PAGE;

  const { data, error, count } = await applyExpenseFilters(
    supabase
      .from("expenses")
      .select(EXPENSE_COLUMNS, { count: "exact" })
      .eq("user_id", user.id)
      .is("group_id", null),
    filters,
  )
    // created_at breaks ties so same-day expenses keep a stable order.
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, from + EXPENSES_PER_PAGE - 1);

  if (error) {
    failed("list", error.message);
  }

  // Summed from its own query rather than from the rows on screen, which are
  // only one page of what the filters matched — and read in chunks, because an
  // unbounded request stops at PostgREST's row ceiling and would make the
  // total quietly short. See `lib/supabase/paged`.
  const { rows: amounts, error: totalError } = await readAllRows((from, to) =>
    applyExpenseFilters(
      supabase
        .from("expenses")
        .select("amount")
        .eq("user_id", user.id)
        .is("group_id", null),
      filters,
    )
      // `id` is unique, so this order is total — which is what makes paging
      // safe. `expense_date` leads so the partial index can serve it.
      .order("expense_date", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to),
  );

  if (totalError) {
    failed("listTotal", totalError);
  }

  const total = count ?? 0;
  const categories = await listPersonalCategories();

  return {
    expenses: attachCategories(data ?? [], categories),
    total,
    page: safePage,
    pageCount: Math.max(1, Math.ceil(total / EXPENSES_PER_PAGE)),
    filteredTotal: sumAmounts((amounts ?? []).map((row) => row.amount)),
  };
}

/** The most recent personal expenses, for the dashboard. */
export async function listRecentPersonalExpenses(
  limit: number,
): Promise<PersonalExpense[]> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("expenses")
    .select(EXPENSE_COLUMNS)
    .eq("user_id", user.id)
    .is("group_id", null)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    failed("listRecent", error.message);
  }

  const categories = await listPersonalCategories();

  return attachCategories(data ?? [], categories);
}

/**
 * One personal expense, or null.
 *
 * `group_id is null` matters here: without it, a group expense the user can
 * read would open in the personal editor.
 */
export async function getPersonalExpense(
  id: string,
): Promise<PersonalExpense | null> {
  // From a route segment: a value that is not a uuid names nothing, and would
  // otherwise reach Postgres as a failed cast and surface as an error page
  // instead of the 404 the caller renders for an expense that is not theirs.
  if (!isUuid(id)) {
    return null;
  }

  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("expenses")
    .select(EXPENSE_COLUMNS)
    .eq("id", id)
    .eq("user_id", user.id)
    .is("group_id", null)
    .maybeSingle();

  if (error) {
    failed("get", error.message);
  }

  if (!data) {
    return null;
  }

  const categories = await listPersonalCategories();

  return attachCategories([data], categories)[0];
}
