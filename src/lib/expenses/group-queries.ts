import "server-only";

import { cache } from "react";

import { requireUser } from "@/lib/auth/dal";
import { applyExpenseFilters } from "@/lib/expenses/filter-query";
import { EMPTY_FILTERS, type ExpenseFilters } from "@/lib/expenses/filters";
import type { ExpenseCategory } from "@/lib/expenses/queries";
import { sumAmounts } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import type { Expense } from "@/types";

/**
 * Reads of one group's expenses.
 *
 * Every query filters on `group_id`, which is both the intent at the call site
 * and the index PostgreSQL uses. It is not the security boundary: RLS returns
 * a group's expenses only to its members, so a non-member asking for them gets
 * an empty result rather than a refusal — the same answer as a group that does
 * not exist, which is what the page should render either way.
 *
 * The permission a *page* still has to decide is who may edit a row.
 * Specification section 9 and the `expenses_update_author_or_admin` policy
 * agree on the rule: the member who recorded it, or any admin of the group.
 * `canEdit` below states it once so no page has to restate it.
 */

export const GROUP_EXPENSES_PER_PAGE = 20;

/** A group expense with the names a list needs, resolved for display. */
export type GroupExpense = Expense & {
  category: ExpenseCategory | null;
  /** The member recorded as having paid. Null if their account is gone. */
  paidByName: string | null;
  /** Whether the signed-in user may edit or delete this row. */
  canEdit: boolean;
};

export type GroupExpensePage = {
  expenses: GroupExpense[];
  total: number;
  page: number;
  pageCount: number;
  /** Total of the rows the filters match, in minor units. */
  filteredTotal: number;
};

const EXPENSE_COLUMNS =
  "id, user_id, group_id, paid_by, category_id, personal_owner_id, item_name, amount, currency_code, expense_date, payment_mode, notes, created_at, updated_at";

function failed(context: string, message: string): never {
  // Detail stays server-side; the error boundary shows friendly copy.
  console.error(`[group-expenses:${context}]`, message);
  throw new Error("We couldn't load this group's expenses. Please try again.");
}

/**
 * A group's categories.
 *
 * Members can read them all; only an admin can create or archive one
 * (specification section 14). Archived ones are returned too, so an expense
 * that still points at one can name it.
 */
export const listGroupCategories = cache(
  async (groupId: string): Promise<ExpenseCategory[]> => {
    await requireUser();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("categories")
      .select("id, name, is_archived")
      .eq("group_id", groupId)
      .order("name", { ascending: true });

    if (error) {
      failed("listCategories", error.message);
    }

    return data ?? [];
  },
);

/**
 * Display names for the group's members, keyed by user id.
 *
 * Exported because the group dashboard needs the same map to attribute
 * spending to people (specification section 21) — one definition of "who is in
 * this group", rather than two that can disagree.
 */
export const memberNames = cache(
  async (groupId: string): Promise<Map<string, string>> => {
    const supabase = await createClient();

    const { data: members, error } = await supabase
      .from("group_members")
      .select("user_id")
      .eq("group_id", groupId);

    if (error) {
      failed("listMembers", error.message);
    }

    const ids = (members ?? []).map((member) => member.user_id);

    if (ids.length === 0) {
      return new Map();
    }

    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, name")
      .in("id", ids);

    if (profileError) {
      failed("listMemberProfiles", profileError.message);
    }

    return new Map((profiles ?? []).map((profile) => [profile.id, profile.name]));
  },
);

type Decorations = {
  categories: ExpenseCategory[];
  names: Map<string, string>;
  viewerId: string;
  isAdmin: boolean;
};

function decorate(expenses: Expense[], context: Decorations): GroupExpense[] {
  const byId = new Map(
    context.categories.map((category) => [category.id, category]),
  );

  return expenses.map((expense) => ({
    ...expense,
    category: expense.category_id
      ? (byId.get(expense.category_id) ?? null)
      : null,
    paidByName: context.names.get(expense.paid_by) ?? null,
    canEdit: context.isAdmin || expense.user_id === context.viewerId,
  }));
}

/**
 * One page of a group's expenses, newest first.
 *
 * `isAdmin` comes from the caller, which has already read the group's detail
 * and therefore knows the viewer's role — passing it avoids a second
 * membership lookup per request.
 */
export async function listGroupExpenses(
  groupId: string,
  {
    page = 1,
    filters = EMPTY_FILTERS,
    isAdmin = false,
  }: { page?: number; filters?: ExpenseFilters; isAdmin?: boolean } = {},
): Promise<GroupExpensePage> {
  const user = await requireUser();
  const supabase = await createClient();

  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const from = (safePage - 1) * GROUP_EXPENSES_PER_PAGE;

  const { data, error, count } = await applyExpenseFilters(
    supabase
      .from("expenses")
      .select(EXPENSE_COLUMNS, { count: "exact" })
      .eq("group_id", groupId),
    filters,
  )
    // created_at breaks ties so same-day expenses keep a stable order.
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, from + GROUP_EXPENSES_PER_PAGE - 1);

  if (error) {
    failed("list", error.message);
  }

  // The page's rows are not the whole filtered set, so the total is summed
  // from its own query rather than from what happens to be on screen. This
  // reads every matching amount, which is fine for one group's expenses; a
  // database-side aggregate is what the dashboard uses when several such
  // figures are wanted at once.
  const { data: amounts, error: totalError } = await applyExpenseFilters(
    supabase.from("expenses").select("amount").eq("group_id", groupId),
    filters,
  );

  if (totalError) {
    failed("listTotal", totalError.message);
  }

  const total = count ?? 0;
  const [categories, names] = await Promise.all([
    listGroupCategories(groupId),
    memberNames(groupId),
  ]);

  return {
    expenses: decorate(data ?? [], {
      categories,
      names,
      viewerId: user.id,
      isAdmin,
    }),
    total,
    page: safePage,
    pageCount: Math.max(1, Math.ceil(total / GROUP_EXPENSES_PER_PAGE)),
    filteredTotal: sumAmounts((amounts ?? []).map((row) => row.amount)),
  };
}

/** The most recent expenses in a group, for the group's own page. */
export async function listRecentGroupExpenses(
  groupId: string,
  limit: number,
  isAdmin = false,
): Promise<{ expenses: GroupExpense[]; total: number; sum: number }> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error, count } = await supabase
    .from("expenses")
    .select(EXPENSE_COLUMNS, { count: "exact" })
    .eq("group_id", groupId)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    failed("listRecent", error.message);
  }

  const { data: amounts, error: totalError } = await supabase
    .from("expenses")
    .select("amount")
    .eq("group_id", groupId);

  if (totalError) {
    failed("recentTotal", totalError.message);
  }

  const [categories, names] = await Promise.all([
    listGroupCategories(groupId),
    memberNames(groupId),
  ]);

  return {
    expenses: decorate(data ?? [], {
      categories,
      names,
      viewerId: user.id,
      isAdmin,
    }),
    total: count ?? 0,
    sum: sumAmounts((amounts ?? []).map((row) => row.amount)),
  };
}

/**
 * One group expense, or null.
 *
 * `group_id` is matched as well as the id, so a personal expense — or one
 * belonging to a different group — can never open in this group's editor.
 */
export async function getGroupExpense(
  groupId: string,
  expenseId: string,
  isAdmin = false,
): Promise<GroupExpense | null> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("expenses")
    .select(EXPENSE_COLUMNS)
    .eq("id", expenseId)
    .eq("group_id", groupId)
    .maybeSingle();

  if (error) {
    failed("get", error.message);
  }

  if (!data) {
    return null;
  }

  const [categories, names] = await Promise.all([
    listGroupCategories(groupId),
    memberNames(groupId),
  ]);

  return decorate([data], {
    categories,
    names,
    viewerId: user.id,
    isAdmin,
  })[0];
}
