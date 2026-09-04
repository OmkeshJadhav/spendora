import "server-only";

import { requireProfile } from "@/lib/auth/dal";
import { applyExpenseFilters } from "@/lib/expenses/filter-query";
import type { ExpenseFilters } from "@/lib/expenses/filters";
import {
  listGroupCategories,
  memberNames,
} from "@/lib/expenses/group-queries";
import { listPersonalCategories } from "@/lib/expenses/queries";
import { buildExportRows, type ExportRow } from "@/lib/export/rows";
import { getGroupDetail } from "@/lib/groups/queries";
import { DEFAULT_CURRENCY_CODE } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import type { CurrencyCode, Expense } from "@/types";

/**
 * Reading the rows an export is made of (specification §25).
 *
 * The same `ExpenseFilters` the list is showing, applied through the same
 * `applyExpenseFilters` the list uses. That is the whole design: exporting is
 * "give me a file of what I am looking at", not a second way of asking the
 * database a question. A filter that narrows the screen narrows the file
 * identically, because there is only one implementation of what a filter
 * means.
 *
 * Nothing here is a permission check. RLS returns a user only their own
 * personal expenses, and a group's expenses only to its members, so an export
 * cannot reach a row the list could not. The one authorization decision left
 * is the group export's, and it is the same one the group page makes: no
 * detail row back means either no such group or not a member, and both should
 * look identical from outside.
 */

const EXPENSE_COLUMNS =
  "id, user_id, group_id, paid_by, category_id, personal_owner_id, item_name, amount, currency_code, expense_date, payment_mode, notes, created_at, updated_at";

/**
 * How many rows are read per request while paging.
 *
 * PostgREST can be configured with a maximum number of rows per response, and
 * a silently short answer would be an export missing expenses without saying
 * so. Paging explicitly means the result does not depend on that setting.
 */
const CHUNK_SIZE = 1000;

/**
 * The most rows one export may contain.
 *
 * Deliberately a hard stop rather than a silent truncation: a file that is
 * quietly missing December is worse than no file, because nothing about it
 * says so. §25 is about a selected month, and a month above this figure is not
 * a real month — so the route turns this into a message asking the person to
 * narrow the range, which is advice they can act on.
 */
export const EXPORT_MAX_ROWS = 10_000;

/** Raised when the filters match more rows than one file should carry. */
export class ExportTooLargeError extends Error {
  constructor() {
    super("Export exceeds the maximum number of rows.");
    this.name = "ExportTooLargeError";
  }
}

function failed(context: string, message: string): never {
  // Detail stays server-side; the route serves friendly copy.
  console.error(`[export:${context}]`, message);
  throw new Error("We couldn't build your export. Please try again.");
}

/** What a route needs to write and name a file. */
export type ExportData = {
  rows: ExportRow[];
  /** Every row's currency: a group has one (§10), a personal list the default. */
  currency: CurrencyCode;
  /** The name the file and its sheet are built from. */
  scope: string;
};

/** Which expenses an export covers. Personal and group are the only two. */
type ExportScope = { kind: "personal"; userId: string } | { kind: "group"; groupId: string };

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * A fresh query for the scope's rows.
 *
 * Built per chunk rather than reused: a PostgREST builder describes one
 * request, so paging means a new one each time rather than a new `.range()` on
 * the last.
 *
 * The owning clause is the only thing that differs between a personal export
 * and a group export — everything after it, filters included, is shared.
 */
function scopedQuery(supabase: SupabaseClient, scope: ExportScope) {
  const base = supabase.from("expenses").select(EXPENSE_COLUMNS);

  return scope.kind === "group"
    ? base.eq("group_id", scope.groupId)
    : base.eq("user_id", scope.userId).is("group_id", null);
}

/**
 * Every matching expense, oldest first, read in chunks.
 *
 * Ascending order is a deliberate difference from the list, which shows the
 * newest first because that is what a person opening a page wants to see. A
 * file is a document rather than a screen: a statement reads forwards, and a
 * reader who wants it the other way sorts a column.
 */
async function readAll(
  scope: ExportScope,
  filters: ExpenseFilters,
): Promise<Expense[]> {
  const supabase = await createClient();
  const collected: Expense[] = [];

  for (let offset = 0; offset <= EXPORT_MAX_ROWS; offset += CHUNK_SIZE) {
    const { data, error } = await applyExpenseFilters(
      scopedQuery(supabase, scope),
      filters,
    )
      .order("expense_date", { ascending: true })
      .order("created_at", { ascending: true })
      .range(offset, offset + CHUNK_SIZE - 1);

    if (error) {
      failed(scope.kind, error.message);
    }

    const chunk = data ?? [];
    collected.push(...chunk);

    if (collected.length > EXPORT_MAX_ROWS) {
      throw new ExportTooLargeError();
    }

    // A short chunk is the end of the rows; a full one may not be.
    if (chunk.length < CHUNK_SIZE) {
      break;
    }
  }

  return collected;
}

/** A lookup from category id to name, for whichever list is exporting. */
function categoryLookup(
  categories: readonly { id: string; name: string }[],
): (id: string | null) => string | null {
  const byId = new Map(categories.map((category) => [category.id, category.name]));

  return (id) => (id ? (byId.get(id) ?? null) : null);
}

/**
 * The signed-in user's own expenses, as export rows.
 *
 * A personal expense is always the user's own and always paid by them, so the
 * payer is one name rather than a lookup — but §25 still asks for the column,
 * and a file that omits it would not merge with a group's export.
 */
export async function personalExportData(
  filters: ExpenseFilters,
): Promise<ExportData> {
  const profile = await requireProfile();

  const [expenses, categories] = await Promise.all([
    readAll({ kind: "personal", userId: profile.id }, filters),
    listPersonalCategories(),
  ]);

  return {
    rows: buildExportRows(expenses, {
      categoryName: categoryLookup(categories),
      payerName: () => profile.name,
    }),
    currency: DEFAULT_CURRENCY_CODE,
    scope: "personal",
  };
}

/**
 * One group's expenses, as export rows, or null when the viewer may not see
 * them.
 *
 * Null covers both "no such group" and "not a member of it" — RLS answers the
 * two the same way, and so should the route.
 */
export async function groupExportData(
  groupId: string,
  filters: ExpenseFilters,
): Promise<ExportData | null> {
  const detail = await getGroupDetail(groupId);

  if (!detail) {
    return null;
  }

  const { group } = detail;

  const [expenses, categories, names] = await Promise.all([
    readAll({ kind: "group", groupId: group.id }, filters),
    listGroupCategories(group.id),
    memberNames(group.id),
  ]);

  return {
    rows: buildExportRows(expenses, {
      categoryName: categoryLookup(categories),
      payerName: (userId) => names.get(userId) ?? null,
    }),
    currency: group.currency_code,
    scope: group.name,
  };
}
