import { percentageOf } from "@/lib/money";

/**
 * Budget arithmetic (specification sections 15 and 16).
 *
 * Pure, and deliberately free of any server import, so the same function
 * decides what a page renders and what a test asserts. Everything is in
 * integer minor units — paise, cents — for the reason `lib/money` gives:
 * repeated addition of doubles is not exact, and a budget that reads
 * "₹0.01 remaining" when it is level would be a bug nobody could explain.
 */

/**
 * How a category is doing against its budget.
 *
 * `none` is not a fourth severity — it is the absence of a budget, which the
 * UI states rather than colours.
 */
export type BudgetState = "none" | "healthy" | "warning" | "exceeded";

/** Spending at or above this share of a budget is a warning. */
export const WARNING_THRESHOLD = 80;

export type BudgetProgress = {
  state: BudgetState;
  /** Minor units. Null when no budget is set. */
  budget: number | null;
  /** Minor units. */
  spent: number;
  /** Minor units. Negative once the budget is exceeded. Null without one. */
  remaining: number | null;
  /** Whole-number percentage of the budget used. 0 without a budget. */
  used: number;
  /** `used`, clamped to 0-100, for drawing a bar that cannot overflow. */
  barWidth: number;
  /** The state in words, so nothing depends on seeing colour. */
  label: string;
};

/**
 * Compares one category's spending with its budget.
 *
 * A budget of null (none set) is not the same as a budget of zero: the first
 * means "not tracked", and the database's `amount > 0` constraint means the
 * second cannot be stored at all.
 */
export function budgetProgress(
  spent: number,
  budget: number | null,
): BudgetProgress {
  if (budget === null || budget <= 0) {
    return {
      state: "none",
      budget: null,
      spent,
      remaining: null,
      used: 0,
      barWidth: 0,
      label: "No budget set",
    };
  }

  const used = percentageOf(spent, budget);
  const remaining = budget - spent;

  // Thresholds are read from the *exact* amounts rather than from the rounded
  // percentage, so 99.6% of a budget is not reported as having reached 100%.
  const state: BudgetState =
    spent >= budget ? "exceeded" : spent * 100 >= budget * WARNING_THRESHOLD ? "warning" : "healthy";

  return {
    state,
    budget,
    spent,
    remaining,
    used,
    barWidth: Math.min(Math.max(used, 0), 100),
    label:
      state === "exceeded"
        ? "Over budget"
        : state === "warning"
          ? "Nearing budget"
          : "On track",
  };
}

/** Totals across categories, for the month's summary card. */
export type BudgetTotals = {
  /** Minor units. The sum of every budget set, ignoring categories without one. */
  budget: number;
  /** Minor units. Everything spent in the month, budgeted or not. */
  spent: number;
  /** Minor units. Negative once total spending passes the total budget. */
  remaining: number;
  used: number;
  hasBudget: boolean;
};

export function budgetTotals(
  rows: readonly { spent: number; budget: number | null }[],
  /** Spending that no budget covers — uncategorised, or an unbudgeted category. */
  spentTotal: number,
): BudgetTotals {
  const budget = rows.reduce((total, row) => total + (row.budget ?? 0), 0);

  return {
    budget,
    spent: spentTotal,
    remaining: budget - spentTotal,
    used: percentageOf(spentTotal, budget),
    hasBudget: budget > 0,
  };
}
