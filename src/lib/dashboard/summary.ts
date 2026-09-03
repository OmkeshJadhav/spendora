import { elapsedDaysInMonth } from "@/lib/dates";
import { percentageOf } from "@/lib/money";
import type { MonthKey } from "@/types";

/**
 * Dashboard arithmetic (specification sections 17-21).
 *
 * Pure, and free of any server import, so the same functions decide what a
 * page renders and what a test asserts. Everything is in integer minor units,
 * for the reason `lib/money` gives: repeated addition of doubles is not exact,
 * and a dashboard is nothing but repeated addition.
 *
 * Shares are whole numbers and are rounded independently, so a set of them can
 * total 99 or 101. That is deliberate — the alternative is an adjusted figure
 * that does not match the amount printed beside it, which is worse.
 */

/** Spending in one category, or in a fold of several. */
export type CategoryTotal = {
  /** Stable key for React and for tests. `uncategorised` and `other` are folds. */
  key: string;
  name: string;
  /** Minor units. */
  total: number;
  /** Whole-number share of the month's spending. */
  share: number;
};

export type MemberTotal = {
  userId: string;
  name: string;
  /** Minor units. */
  total: number;
  count: number;
  share: number;
  /** True for the signed-in user's own row, which the UI labels "You". */
  isSelf: boolean;
};

export type TrendPoint = {
  month: MonthKey;
  /** Minor units. */
  total: number;
  count: number;
  /** True for the month the dashboard is currently showing. */
  isSelected: boolean;
};

export const UNCATEGORISED_LABEL = "Uncategorised";
export const OTHER_LABEL = "Other categories";

/**
 * How many categories the breakdown names before folding the tail.
 *
 * Past roughly this many, a ranked list stops being read and starts being
 * scrolled; the categories page carries the full set either way.
 */
export const BREAKDOWN_LIMIT = 6;

/**
 * The month's spending as a ranked breakdown (specification section 17).
 *
 * Categories with nothing spent in them are left out — a dashboard reports
 * what happened, and the categories page is where the full list lives.
 * Spending with no category is a row of its own rather than being dropped,
 * so the parts always add up to the total shown above them.
 */
export function categoryTotals(
  categories: readonly { id: string; name: string; spent: number }[],
  uncategorised: number,
  limit = BREAKDOWN_LIMIT,
): CategoryTotal[] {
  const rows = categories
    .filter((category) => category.spent > 0)
    .map((category) => ({
      key: category.id,
      name: category.name,
      total: category.spent,
    }));

  if (uncategorised > 0) {
    rows.push({
      key: "uncategorised",
      name: UNCATEGORISED_LABEL,
      total: uncategorised,
    });
  }

  rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const shown = rows.length > limit ? rows.slice(0, limit - 1) : rows;
  const folded = rows.slice(shown.length);

  const breakdown: CategoryTotal[] = shown.map((row) => ({
    ...row,
    share: percentageOf(row.total, total),
  }));

  if (folded.length > 0) {
    const foldedTotal = folded.reduce((sum, row) => sum + row.total, 0);

    breakdown.push({
      key: "other",
      name: `${OTHER_LABEL} (${folded.length})`,
      total: foldedTotal,
      share: percentageOf(foldedTotal, total),
    });
  }

  return breakdown;
}

/**
 * Spending per member (specification section 21).
 *
 * Every current member is listed, including one who has paid nothing: "Sneha
 * has spent nothing this month" is information, and a member who silently
 * vanished from the list would read as a bug. Someone who paid and has since
 * left the group keeps their row, because their money is still in the total.
 */
export function memberTotals(
  members: readonly { userId: string; name: string }[],
  paid: ReadonlyMap<string, { total: number; count: number }>,
  viewerId: string,
  /** What to call somebody who paid but is no longer in the group. */
  formerLabel = "Former member",
): MemberTotal[] {
  const known = new Map(members.map((member) => [member.userId, member.name]));

  for (const userId of paid.keys()) {
    if (!known.has(userId)) {
      known.set(userId, formerLabel);
    }
  }

  const total = [...paid.values()].reduce((sum, row) => sum + row.total, 0);

  return [...known.entries()]
    .map(([userId, name]) => {
      const spend = paid.get(userId) ?? { total: 0, count: 0 };

      return {
        userId,
        name,
        total: spend.total,
        count: spend.count,
        share: percentageOf(spend.total, total),
        isSelf: userId === viewerId,
      };
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

/**
 * Average spending per day of the month so far (specification section 17).
 *
 * Divides by days *elapsed*, not by the month's length, so a figure read on
 * the 3rd is not diluted by the 27 days that have not happened yet.
 */
export function averageDaily(total: number, month: MonthKey): number {
  const elapsed = elapsedDaysInMonth(month);

  return elapsed > 0 ? Math.round(total / elapsed) : 0;
}
