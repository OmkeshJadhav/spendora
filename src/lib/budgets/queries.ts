import "server-only";

import {
  budgetProgress,
  budgetTotals,
  type BudgetProgress,
  type BudgetState,
  type BudgetTotals,
} from "@/lib/budgets/status";
import { ownerColumn, type CategoryOwner } from "@/lib/categories/owner";
import { listOwnerCategories, type CategorySummary } from "@/lib/categories/queries";
import { monthRange, monthStartIso, type IsoDate } from "@/lib/dates";
import { sumAmounts, toMinorUnits } from "@/lib/money";
import { readAllRows } from "@/lib/supabase/paged";
import { createClient } from "@/lib/supabase/server";
import type { MonthKey } from "@/types";

/**
 * Budget vs actual for one month (specification sections 15, 16 and 19).
 *
 * Personal and group budgets are the same question asked of a different owning
 * column, so there is one implementation and `CategoryOwner` selects the
 * column. RLS is what makes either safe: a group's budgets are readable by its
 * members and writable only by its admins, and a personal budget only by the
 * person it belongs to. The filters below state intent and use the indexes;
 * they are not the boundary.
 *
 * `period_month` is how "monthly budgets now, month-specific budgets later"
 * (section 15) is satisfied without a schema change: a row with the month set
 * wins for that month, and the standing row (`period_month is null`) applies
 * everywhere else. Only standing budgets are editable in the UI today; reading
 * already honours both.
 */

function failed(context: string, message: string): never {
  // Detail stays server-side; the error boundary shows friendly copy.
  console.error(`[budgets:${context}]`, message);
  throw new Error("We couldn't load budgets. Please try again.");
}

/** A category with its budget and this month's spending against it. */
export type CategoryBudget = {
  category: CategorySummary;
  /** The budget row's id, when one exists — the form edits it by identity. */
  budgetId: string | null;
  /** True when the figure comes from a month-specific override. */
  isMonthSpecific: boolean;
  progress: BudgetProgress;
};

export type BudgetOverview = {
  month: MonthKey;
  rows: CategoryBudget[];
  totals: BudgetTotals;
  /** Minor units spent with no category at all. */
  uncategorised: number;
  /** Minor units spent in categories that carry no budget. */
  unbudgeted: number;
  /** How many expenses the month holds, budgeted or not. */
  expenseCount: number;
};

/** Minor units spent per category id (null for uncategorised) in a month. */
async function spendByCategory(
  owner: CategoryOwner,
  month: MonthKey,
): Promise<{ totals: Map<string | null, number>; total: number; count: number }> {
  const supabase = await createClient();
  const { start, end } = monthRange(month);
  const { column, value } = ownerColumn(owner);

  // Chunked, because this is a total: an unbounded request stops at
  // PostgREST's row ceiling, and every figure on both dashboards is derived
  // from these rows. See `lib/supabase/paged`.
  const { rows, error } = await readAllRows((from, to) => {
    let query = supabase
      .from("expenses")
      .select("amount, category_id")
      .eq(column, value)
      .gte("expense_date", start satisfies IsoDate)
      .lte("expense_date", end satisfies IsoDate);

    // A personal expense is one with no group. Without this, a user's group
    // expenses would count against their private budgets.
    if (owner.kind === "personal") {
      query = query.is("group_id", null);
    }

    // `id` is unique, so this order is total — which is what makes paging safe.
    return query
      .order("expense_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
  });

  if (error) {
    failed("spendByCategory", error);
  }

  const totals = new Map<string | null, number>();

  for (const row of rows) {
    totals.set(
      row.category_id,
      (totals.get(row.category_id) ?? 0) + toMinorUnits(row.amount),
    );
  }

  return {
    totals,
    total: sumAmounts(rows.map((row) => row.amount)),
    count: rows.length,
  };
}

/**
 * The effective budget for each category in a month.
 *
 * Both the standing rows and the month's own overrides are fetched in one
 * query and resolved here, which is one round trip rather than two and makes
 * the precedence rule visible in one place.
 */
async function effectiveBudgets(
  owner: CategoryOwner,
  month: MonthKey,
): Promise<Map<string, { id: string; amount: number; isMonthSpecific: boolean }>> {
  const supabase = await createClient();
  const { column, value } = ownerColumn(owner);
  const periodStart = monthStartIso(month);

  const { data, error } = await supabase
    .from("budgets")
    .select("id, category_id, amount, period_month")
    .eq(column, value)
    .or(`period_month.is.null,period_month.eq.${periodStart}`);

  if (error) {
    failed("listBudgets", error.message);
  }

  const resolved = new Map<
    string,
    { id: string; amount: number; isMonthSpecific: boolean }
  >();

  for (const row of data ?? []) {
    const isMonthSpecific = row.period_month !== null;
    const current = resolved.get(row.category_id);

    // A month-specific row overrides the standing one; the standing row is
    // only used when the month has none of its own.
    if (!current || (isMonthSpecific && !current.isMonthSpecific)) {
      resolved.set(row.category_id, {
        id: row.id,
        amount: toMinorUnits(row.amount),
        isMonthSpecific,
      });
    }
  }

  return resolved;
}

/**
 * Everything the budgets view needs for one month, in three reads, run
 * together. The spending read pages when a month is busy enough to need it, so
 * "three" is the floor rather than a promise.
 *
 * Rows are ordered by need rather than by name: over budget first, then
 * nearing it, then the rest — so the categories that want attention are the
 * ones at the top rather than the ones that happen to start with "A".
 */
export async function getBudgetOverview(
  owner: CategoryOwner,
  month: MonthKey,
): Promise<BudgetOverview> {
  const [categories, budgets, spending] = await Promise.all([
    listOwnerCategories(owner),
    effectiveBudgets(owner, month),
    spendByCategory(owner, month),
  ]);

  const rows: CategoryBudget[] = categories.map((category) => {
    const budget = budgets.get(category.id) ?? null;
    const spent = spending.totals.get(category.id) ?? 0;

    return {
      category,
      budgetId: budget?.id ?? null,
      isMonthSpecific: budget?.isMonthSpecific ?? false,
      progress: budgetProgress(spent, budget?.amount ?? null),
    };
  });

  rows.sort(compareByAttention);

  const unbudgeted = rows.reduce(
    (total, row) => (row.progress.budget === null ? total + row.progress.spent : total),
    0,
  );

  return {
    month,
    rows,
    totals: budgetTotals(
      rows.map((row) => ({ spent: row.progress.spent, budget: row.progress.budget })),
      spending.total,
    ),
    uncategorised: spending.totals.get(null) ?? 0,
    unbudgeted,
    expenseCount: spending.count,
  };
}

/** Over budget, then nearing it, then healthy, then unbudgeted; archived last. */
const ATTENTION_ORDER: Record<BudgetState, number> = {
  exceeded: 0,
  warning: 1,
  healthy: 2,
  none: 3,
};

function compareByAttention(a: CategoryBudget, b: CategoryBudget): number {
  if (a.category.is_archived !== b.category.is_archived) {
    return a.category.is_archived ? 1 : -1;
  }

  const rank = ATTENTION_ORDER[a.progress.state] - ATTENTION_ORDER[b.progress.state];

  if (rank !== 0) {
    return rank;
  }

  // Within a band, the biggest spender is the more interesting row.
  if (a.progress.spent !== b.progress.spent) {
    return b.progress.spent - a.progress.spent;
  }

  return a.category.name.localeCompare(b.category.name);
}
