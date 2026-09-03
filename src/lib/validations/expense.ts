import { z } from "zod";

import { isIsoDate, maxExpenseDate, MIN_EXPENSE_DATE } from "@/lib/dates";
import { PAYMENT_MODES } from "@/lib/constants";
import { MAX_AMOUNT } from "@/lib/money";
import type { PaymentMode } from "@/types";

/**
 * Expense input schema (specification section 7).
 *
 * The same schema runs in the browser for fast feedback and again on the
 * server, which never trusts the client's checks. Every field arrives from
 * `FormData` as a string, so parsing is part of validation rather than
 * something a call site remembers to do afterwards.
 */

/** Sentinel select values for the category control. */
export const CATEGORY_NONE = "";
export const CATEGORY_CREATE = "__create__";
/** A category chosen by name rather than id — a suggestion, or a new one. */
export const CATEGORY_NAME_PREFIX = "name:";

const paymentModeValues: readonly string[] = PAYMENT_MODES.map(
  (mode) => mode.value,
);

const itemName = z
  .string()
  .trim()
  .min(1, "Item name is required")
  .max(120, "Item name must be 120 characters or fewer");

/**
 * Money in, as typed. Rejected rather than rounded when it carries more than
 * two decimals, so nobody's ₹10.999 silently becomes ₹11.00.
 */
const amount = z
  .string()
  .trim()
  .min(1, "Amount is required")
  .refine(
    (value) => /^-?\d{1,12}(\.\d{1,2})?$/.test(value),
    "Enter an amount such as 1250 or 1250.50",
  )
  .transform(Number)
  .refine((value) => Number.isFinite(value), "Enter a valid amount")
  .refine((value) => value > 0, "Amount must be greater than zero")
  .refine((value) => value <= MAX_AMOUNT, "That amount is too large");

const expenseDate = z
  .string()
  .trim()
  .min(1, "Date is required")
  .refine(isIsoDate, "Enter a valid date")
  .refine((value) => value >= MIN_EXPENSE_DATE, "That date is too far in the past")
  .refine(
    (value) => value <= maxExpenseDate(),
    "That date is too far in the future",
  );

const paymentMode = z
  .string()
  .trim()
  .refine(
    (value) => value === "" || paymentModeValues.includes(value),
    "Choose a payment mode from the list",
  )
  .transform((value) => (value === "" ? null : (value as PaymentMode)));

const notes = z
  .string()
  .trim()
  .max(500, "Notes must be 500 characters or fewer")
  .transform((value) => (value === "" ? null : value));

/** Free-text category name, matching the database's own length constraint. */
const categoryName = z
  .string()
  .trim()
  .min(1, "Category name is required")
  .max(60, "Category name must be 60 characters or fewer");

/** Every field an expense form submits, group or personal. */
const expenseFields = {
  itemName,
  amount,
  expenseDate,
  /** An existing category id, a `name:` selection, or the create sentinel. */
  category: z.string().trim().max(120).default(CATEGORY_NONE),
  /** Only read when `category` is the create sentinel. */
  newCategoryName: z.string().trim().max(60).default(""),
  paymentMode,
  notes,
};

/** A new category name is only required when the form asked to create one. */
function checkNewCategoryName(
  value: { category: string; newCategoryName: string },
  ctx: z.RefinementCtx,
): void {
  if (value.category !== CATEGORY_CREATE) {
    return;
  }

  const parsed = categoryName.safeParse(value.newCategoryName);

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      ctx.addIssue({
        code: "custom",
        path: ["newCategoryName"],
        message: issue.message,
      });
    }
  }
}

export const expenseSchema = z
  .object(expenseFields)
  .superRefine(checkNewCategoryName)
  .transform((value) => ({
    itemName: value.itemName,
    amount: value.amount,
    expenseDate: value.expenseDate,
    paymentMode: value.paymentMode,
    notes: value.notes,
    category: resolveCategoryChoice(value.category, value.newCategoryName),
  }));

/**
 * A group expense (specification sections 7 and 45).
 *
 * The one extra field is `paidBy`: in a group, any member may be recorded as
 * having paid. Only its *shape* is checked here — whether that person is
 * actually a member of this group is a question for the database, which
 * answers it with a trigger on every insert and update.
 */
export const groupExpenseSchema = z
  .object({
    ...expenseFields,
    paidBy: z.uuid("Choose who paid from the list"),
  })
  .superRefine(checkNewCategoryName)
  .transform((value) => ({
    itemName: value.itemName,
    amount: value.amount,
    expenseDate: value.expenseDate,
    paymentMode: value.paymentMode,
    notes: value.notes,
    paidBy: value.paidBy,
    category: resolveCategoryChoice(value.category, value.newCategoryName),
  }));

/**
 * What the category select actually asked for.
 *
 * Resolving an id happens later, against the database, because only the
 * database can say whether the id belongs to this user.
 */
export type CategoryChoice =
  | { kind: "none" }
  | { kind: "existing"; id: string }
  | { kind: "name"; name: string };

function resolveCategoryChoice(
  category: string,
  newCategoryName: string,
): CategoryChoice {
  if (category === CATEGORY_CREATE) {
    return { kind: "name", name: newCategoryName.trim() };
  }

  if (category.startsWith(CATEGORY_NAME_PREFIX)) {
    return {
      kind: "name",
      name: category.slice(CATEGORY_NAME_PREFIX.length).trim(),
    };
  }

  if (category === CATEGORY_NONE) {
    return { kind: "none" };
  }

  return { kind: "existing", id: category };
}

export type ExpenseInput = z.infer<typeof expenseSchema>;
export type GroupExpenseInput = z.infer<typeof groupExpenseSchema>;
