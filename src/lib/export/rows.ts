import { paymentModeLabel } from "@/lib/constants";
import type { IsoDate } from "@/lib/dates";
import type { CurrencyCode, Expense } from "@/types";

/**
 * The shape of an exported expense, and the columns it becomes (§25).
 *
 * Both writers read this one definition, so a CSV and a spreadsheet of the
 * same month can never end up with different columns, a different order, or a
 * different idea of what an empty cell means. Adding a column is an entry in
 * `EXPORT_COLUMNS` and a field on `ExportRow`; neither writer changes.
 *
 * Values are kept in their own types rather than pre-formatted into strings.
 * That is the whole reason a spreadsheet is worth offering beside a CSV: an
 * amount that reaches Excel as a number can be summed, and a date that reaches
 * it as a date can be sorted and pivoted. Formatting happens in each writer,
 * as late as it can.
 */

/** How a writer should treat a column's value. */
export type ExportCellKind = "text" | "date" | "amount" | "timestamp";

export type ExportRow = {
  /** The calendar day the expense is dated. */
  date: IsoDate;
  item: string;
  amount: number;
  currency: CurrencyCode;
  paidBy: string;
  /** Empty when no category was recorded. */
  category: string;
  /** Empty when no payment mode was recorded. */
  paymentMode: string;
  notes: string;
  /** When the expense was recorded, as UTC ISO 8601. */
  createdAt: string;
};

export type ExportColumn = {
  readonly key: keyof ExportRow;
  readonly header: string;
  readonly kind: ExportCellKind;
  /** Rough character width, for the spreadsheet's column sizing. */
  readonly width: number;
};

/**
 * The columns §25 lists, in the order it lists them.
 *
 * Amount and Currency are deliberately two columns rather than one formatted
 * string. "₹2,450.00" in an Amount column is a picture of a number: it cannot
 * be summed, sorted or filtered, which is the only reason to open the file at
 * all. The code goes in its own column, where it is also the thing a reader
 * merging two groups' exports would need.
 */
export const EXPORT_COLUMNS = [
  { key: "date", header: "Date", kind: "date", width: 14 },
  { key: "item", header: "Item", kind: "text", width: 28 },
  { key: "amount", header: "Amount", kind: "amount", width: 14 },
  { key: "currency", header: "Currency", kind: "text", width: 10 },
  { key: "paidBy", header: "Paid by", kind: "text", width: 20 },
  { key: "category", header: "Category", kind: "text", width: 18 },
  { key: "paymentMode", header: "Payment mode", kind: "text", width: 16 },
  { key: "notes", header: "Notes", kind: "text", width: 40 },
  { key: "createdAt", header: "Created", kind: "timestamp", width: 26 },
] as const satisfies readonly ExportColumn[];

/**
 * A stored `timestamptz` as UTC ISO 8601.
 *
 * Normalised once, here, rather than in each writer: PostgREST's rendering of
 * the offset varies, and a CSV and a spreadsheet of the same expense must not
 * disagree about when it was recorded.
 *
 * It stays a string in both formats. An instant only means something with its
 * zone attached, and a spreadsheet has nowhere to put one — unlike
 * `expense_date`, which is a calendar day with no zone and so can be a real
 * date cell.
 */
function isoTimestamp(value: string): string {
  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

/** Shown for an expense whose payer no longer has an account. */
export const FORMER_MEMBER = "Former member";

/**
 * How a row's fields are looked up, supplied by whichever list is exporting.
 *
 * A personal export resolves every payer to one name and a group export to a
 * member map, but neither difference belongs in the row builder — so both are
 * passed in as functions and this module stays the one place that knows what
 * a row *is*.
 */
export type ExportLookups = {
  categoryName: (categoryId: string | null) => string | null;
  payerName: (userId: string) => string | null;
};

/**
 * Turns stored expenses into export rows.
 *
 * An optional field that was never recorded becomes an empty cell rather than
 * a word like "Uncategorised". A blank is what a spreadsheet means by "not
 * recorded", and it cannot be confused with a category somebody genuinely
 * named "Uncategorised" — a label there would be indistinguishable from data.
 */
export function buildExportRows(
  expenses: readonly Expense[],
  lookups: ExportLookups,
): ExportRow[] {
  return expenses.map((expense) => ({
    date: expense.expense_date,
    item: expense.item_name,
    amount: expense.amount,
    currency: expense.currency_code,
    paidBy: lookups.payerName(expense.paid_by) ?? FORMER_MEMBER,
    category: lookups.categoryName(expense.category_id) ?? "",
    paymentMode: paymentModeLabel(expense.payment_mode) ?? "",
    notes: expense.notes ?? "",
    createdAt: isoTimestamp(expense.created_at),
  }));
}
