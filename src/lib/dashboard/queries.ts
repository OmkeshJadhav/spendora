import "server-only";

import { requireUser } from "@/lib/auth/dal";
import { getBudgetOverview, type BudgetOverview } from "@/lib/budgets/queries";
import { ownerColumn, type CategoryOwner } from "@/lib/categories/owner";
import {
  averageDaily,
  categoryTotals,
  memberTotals,
  type CategoryTotal,
  type MemberTotal,
  type TrendPoint,
} from "@/lib/dashboard/summary";
import {
  compareMonths,
  monthRange,
  shiftMonth,
  type IsoDate,
} from "@/lib/dates";
import {
  memberNames,
  listRecentGroupExpenses,
  type GroupExpense,
} from "@/lib/expenses/group-queries";
import {
  listRecentPersonalExpenses,
  type PersonalExpense,
} from "@/lib/expenses/queries";
import { toMinorUnits } from "@/lib/money";
import { readAllRows } from "@/lib/supabase/paged";
import { createClient } from "@/lib/supabase/server";
import type { MonthKey } from "@/types";

/**
 * The personal and group dashboards (specification sections 17-21).
 *
 * Both are the same five questions asked of a different owner — what was
 * spent, against what budget, in which categories, over which months, and (for
 * a group) by whom — so `CategoryOwner` selects the owning column and there is
 * one implementation rather than two that drift.
 *
 * RLS is what makes either safe. A personal expense is readable only by the
 * person who recorded it, a group's only by its members; the filters below
 * state intent and use the indexes, they are not the boundary. A non-member
 * asking for a group's dashboard therefore gets empty figures rather than a
 * refusal, and the page turns that into a 404 by way of `getGroupDetail`.
 *
 * `getBudgetOverview` already reads the month's spending per category, so the
 * dashboards build on it rather than asking the same question again: a
 * dashboard costs the budget overview plus one range query, and for a group
 * one more for who paid.
 */

/** How many months the expenditure trend covers, ending with the one shown. */
export const TREND_MONTHS = 6;

/** How many expenses the "recent activity" panel lists. */
const RECENT_LIMIT = 5;

function failed(context: string, message: string): never {
  // Detail stays server-side; the error boundary shows friendly copy.
  console.error(`[dashboard:${context}]`, message);
  throw new Error("We couldn't load your dashboard. Please try again.");
}

/**
 * Spending per month over the window ending at `month` (section 20).
 *
 * One range query rather than one per month, bucketed here by the `YYYY-MM`
 * prefix of `expense_date` — which is a calendar date, so slicing the stored
 * string cannot be moved a day by a timezone the way parsing it could.
 *
 * Months with nothing in them are still returned, at zero: a gap in a trend is
 * information, and a chart that silently skipped them would compress the axis
 * and imply spending was continuous.
 */
export async function monthlyTrend(
  owner: CategoryOwner,
  month: MonthKey,
  months = TREND_MONTHS,
): Promise<TrendPoint[]> {
  const supabase = await createClient();
  const { column, value } = ownerColumn(owner);

  const first = shiftMonth(month, -(months - 1));
  const start = monthRange(first).start;
  const end = monthRange(month).end;

  // Chunked: this covers six months at once, so it is the widest read in the
  // application and the first an unbounded request would truncate — leaving a
  // trend that slopes for a reason that is not spending. See
  // `lib/supabase/paged`.
  const { rows, error } = await readAllRows((from, to) => {
    let query = supabase
      .from("expenses")
      .select("amount, expense_date")
      .eq(column, value)
      .gte("expense_date", start satisfies IsoDate)
      .lte("expense_date", end satisfies IsoDate);

    // A personal expense is one with no group. Without this, a user's group
    // spending would appear on their private trend.
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
    failed("monthlyTrend", error);
  }

  const buckets = new Map<string, { total: number; count: number }>();

  for (const row of rows) {
    const key = row.expense_date.slice(0, 7);
    const bucket = buckets.get(key) ?? { total: 0, count: 0 };

    bucket.total += toMinorUnits(row.amount);
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  return Array.from({ length: months }, (_, index) => {
    const point = shiftMonth(first, index);
    const key = monthRange(point).start.slice(0, 7);
    const bucket = buckets.get(key) ?? { total: 0, count: 0 };

    return {
      month: point,
      total: bucket.total,
      count: bucket.count,
      isSelected: compareMonths(point, month) === 0,
    };
  });
}

/**
 * Who paid what, in one month (section 21).
 *
 * Attribution is by `paid_by`, not by who typed the expense in: a member may
 * record that somebody else paid, and it is the payer the group cares about.
 * This is also the figure a settlement feature would later be computed from
 * (section 46).
 */
export async function memberSpending(
  groupId: string,
  month: MonthKey,
  viewerId: string,
): Promise<MemberTotal[]> {
  const supabase = await createClient();
  const { start, end } = monthRange(month);

  // Chunked for the same reason as every other total here: a short read would
  // understate somebody's share without saying so, and this is the figure a
  // settlement would later be computed from.
  const [{ rows, error }, names] = await Promise.all([
    readAllRows((from, to) =>
      supabase
        .from("expenses")
        .select("amount, paid_by")
        .eq("group_id", groupId)
        .gte("expense_date", start satisfies IsoDate)
        .lte("expense_date", end satisfies IsoDate)
        // `id` is unique, so this order is total.
        .order("expense_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    memberNames(groupId),
  ]);

  if (error) {
    failed("memberSpending", error);
  }

  const paid = new Map<string, { total: number; count: number }>();

  for (const row of rows) {
    const bucket = paid.get(row.paid_by) ?? { total: 0, count: 0 };

    bucket.total += toMinorUnits(row.amount);
    bucket.count += 1;
    paid.set(row.paid_by, bucket);
  }

  const members = [...names.entries()].map(([userId, name]) => ({
    userId,
    name,
  }));

  return memberTotals(members, paid, viewerId);
}

/** Everything both dashboards show, whoever owns the money. */
type DashboardBase = {
  month: MonthKey;
  /** Budget versus actual for the month, per category and in total. */
  overview: BudgetOverview;
  /** The month's spending, ranked and folded (section 17). */
  categories: CategoryTotal[];
  /** Spending per month over the trailing window (section 20). */
  trend: TrendPoint[];
  /** Minor units per day elapsed this month. */
  averageDaily: number;
};

export type PersonalDashboard = DashboardBase & {
  recent: PersonalExpense[];
};

export type GroupDashboard = DashboardBase & {
  /** Spending per member, biggest payer first (section 21). */
  members: MemberTotal[];
  recent: GroupExpense[];
};

/** The breakdown, derived from figures the budget overview already holds. */
function breakdown(overview: BudgetOverview): CategoryTotal[] {
  return categoryTotals(
    overview.rows.map((row) => ({
      id: row.category.id,
      name: row.category.name,
      spent: row.progress.spent,
    })),
    overview.uncategorised,
  );
}

export async function getPersonalDashboard(
  month: MonthKey,
): Promise<PersonalDashboard> {
  const user = await requireUser();
  const owner: CategoryOwner = { kind: "personal", userId: user.id };

  const [overview, trend, recent] = await Promise.all([
    getBudgetOverview(owner, month),
    monthlyTrend(owner, month),
    listRecentPersonalExpenses(RECENT_LIMIT),
  ]);

  return {
    month,
    overview,
    categories: breakdown(overview),
    trend,
    averageDaily: averageDaily(overview.totals.spent, month),
    recent,
  };
}

/**
 * A group's dashboard.
 *
 * `isAdmin` comes from the caller, which has already read the group's detail
 * and so knows the viewer's role; passing it avoids a second membership lookup
 * and keeps "who may edit this row" answered in one place.
 */
export async function getGroupDashboard(
  groupId: string,
  month: MonthKey,
  isAdmin: boolean,
): Promise<GroupDashboard> {
  const user = await requireUser();
  const owner: CategoryOwner = { kind: "group", groupId };

  const [overview, trend, members, recent] = await Promise.all([
    getBudgetOverview(owner, month),
    monthlyTrend(owner, month),
    memberSpending(groupId, month, user.id),
    listRecentGroupExpenses(groupId, RECENT_LIMIT, isAdmin),
  ]);

  return {
    month,
    overview,
    categories: breakdown(overview),
    trend,
    averageDaily: averageDaily(overview.totals.spent, month),
    members,
    recent: recent.expenses,
  };
}
