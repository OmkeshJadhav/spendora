import "server-only";

import { cache } from "react";

import { requireUser } from "@/lib/auth/dal";
import {
  elapsedDaysInMonth,
  monthRange,
  type IsoDate,
} from "@/lib/dates";
import { percentageOf, sumAmounts, toMinorUnits } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import type { Category, Expense, MonthKey } from "@/types";

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

export type CategoryTotal = {
  id: string | null;
  name: string;
  /** Minor units, summed exactly. */
  total: number;
  /** Whole-number share of the month's spending. */
  share: number;
};

export type MonthSummary = {
  month: MonthKey;
  /** Minor units. */
  total: number;
  count: number;
  /** Minor units, per day elapsed so far this month. */
  averageDaily: number;
  categories: CategoryTotal[];
};

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
};

/** One page of personal expenses, newest first. */
export async function listPersonalExpenses(page = 1): Promise<ExpensePage> {
  const user = await requireUser();
  const supabase = await createClient();

  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const from = (safePage - 1) * EXPENSES_PER_PAGE;

  const { data, error, count } = await supabase
    .from("expenses")
    .select(EXPENSE_COLUMNS, { count: "exact" })
    .eq("user_id", user.id)
    .is("group_id", null)
    // created_at breaks ties so same-day expenses keep a stable order.
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, from + EXPENSES_PER_PAGE - 1);

  if (error) {
    failed("list", error.message);
  }

  const total = count ?? 0;
  const categories = await listPersonalCategories();

  return {
    expenses: attachCategories(data ?? [], categories),
    total,
    page: safePage,
    pageCount: Math.max(1, Math.ceil(total / EXPENSES_PER_PAGE)),
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

const UNCATEGORISED = "Uncategorised";

/**
 * Totals for one month (specification section 17).
 *
 * The month's rows are summed here in integer minor units rather than in SQL:
 * one user-month is a small, bounded set, and PostgREST does not expose
 * aggregates by default. Group dashboards, which aggregate across members,
 * will need a database-side summary instead.
 */
export async function getPersonalMonthSummary(
  month: MonthKey,
): Promise<MonthSummary> {
  const user = await requireUser();
  const supabase = await createClient();
  const { start, end } = monthRange(month);

  const { data, error } = await supabase
    .from("expenses")
    .select("amount, category_id")
    .eq("user_id", user.id)
    .is("group_id", null)
    .gte("expense_date", start satisfies IsoDate)
    .lte("expense_date", end satisfies IsoDate);

  if (error) {
    failed("monthSummary", error.message);
  }

  const rows = data ?? [];
  const total = sumAmounts(rows.map((row) => row.amount));
  const elapsed = elapsedDaysInMonth(month);

  const categories = await listPersonalCategories();
  const nameById = new Map(categories.map((c) => [c.id, c.name]));

  const totals = new Map<string | null, number>();

  for (const row of rows) {
    const key = row.category_id;
    totals.set(key, (totals.get(key) ?? 0) + toMinorUnits(row.amount));
  }

  const breakdown: CategoryTotal[] = [...totals.entries()]
    .map(([id, amount]) => ({
      id,
      name: id ? (nameById.get(id) ?? UNCATEGORISED) : UNCATEGORISED,
      total: amount,
      share: percentageOf(amount, total),
    }))
    .sort((a, b) => b.total - a.total);

  return {
    month,
    total,
    count: rows.length,
    averageDaily: elapsed > 0 ? Math.round(total / elapsed) : 0,
    categories: breakdown,
  };
}
