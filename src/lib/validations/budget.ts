import { z } from "zod";

import { MAX_AMOUNT } from "@/lib/money";

/**
 * Budget input schemas (specification sections 15 and 43).
 *
 * A budget amount is money typed into a form, so it is parsed the same way an
 * expense amount is: rejected rather than rounded when it carries more than
 * two decimals, because `numeric(14,2)` would silently round it and nobody
 * asked it to. Zero is not a budget — the database's `amount > 0` check says
 * so too, and clearing a budget deletes the row instead.
 */

const amount = z
  .string()
  .trim()
  .min(1, "Budget amount is required")
  .refine(
    (value) => /^-?\d{1,12}(\.\d{1,2})?$/.test(value),
    "Enter an amount such as 8000 or 8000.50",
  )
  .transform(Number)
  .refine((value) => Number.isFinite(value), "Enter a valid amount")
  .refine((value) => value > 0, "Budget must be greater than zero")
  .refine((value) => value <= MAX_AMOUNT, "That amount is too large");

const categoryId = z.uuid("That category could not be found");

/** Setting or replacing a category's standing monthly budget. */
export const setBudgetSchema = z.object({ categoryId, amount });

export const clearBudgetSchema = z.object({ categoryId });

export type SetBudgetInput = z.infer<typeof setBudgetSchema>;
