import { Pencil } from "lucide-react";
import Link from "next/link";

import { DeleteExpenseButton } from "@/components/expenses/delete-expense-button";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { paymentModeLabel } from "@/lib/constants";
import { formatRelativeDate, type IsoDate } from "@/lib/dates";
import type { PersonalExpense } from "@/lib/expenses/queries";
import { formatCurrency, formatMinorUnits, sumAmounts } from "@/lib/money";
import type { CurrencyCode } from "@/types";

/**
 * The monthly expense list (specification section 22).
 *
 * Rows are cards rather than table cells: an expense has seven fields, and a
 * seven-column table is unreadable on a phone. Days are grouped under a
 * heading with that day's total, which is the question a list like this is
 * usually asked.
 */

function groupByDate(
  expenses: PersonalExpense[],
): [IsoDate, PersonalExpense[]][] {
  const groups = new Map<IsoDate, PersonalExpense[]>();

  // Input is already ordered by date descending, so insertion order is correct.
  for (const expense of expenses) {
    const bucket = groups.get(expense.expense_date);

    if (bucket) {
      bucket.push(expense);
    } else {
      groups.set(expense.expense_date, [expense]);
    }
  }

  return [...groups.entries()];
}

function ExpenseRow({
  expense,
  currencyCode,
}: {
  expense: PersonalExpense;
  currencyCode: CurrencyCode;
}) {
  const payment = paymentModeLabel(expense.payment_mode);

  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">{expense.item_name}</span>
          {expense.category ? (
            <Badge>{expense.category.name}</Badge>
          ) : (
            <Badge className="text-muted-foreground">Uncategorised</Badge>
          )}
        </div>

        <p className="mt-1 text-xs text-muted-foreground">
          {payment ? <span>{payment}</span> : <span>Payment not recorded</span>}
          {expense.notes ? (
            <>
              <span aria-hidden> · </span>
              <span className="break-words">{expense.notes}</span>
            </>
          ) : null}
        </p>
      </div>

      <div className="flex items-center justify-between gap-2 sm:justify-end">
        <span className="tabular text-base font-semibold">
          {formatCurrency(expense.amount, currencyCode)}
        </span>

        <div className="flex items-center gap-1">
          <Link
            href={`/expenses/${expense.id}/edit`}
            aria-label={`Edit ${expense.item_name}`}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            <Pencil aria-hidden />
            <span className="sr-only sm:not-sr-only">Edit</span>
          </Link>
          <DeleteExpenseButton id={expense.id} itemName={expense.item_name} />
        </div>
      </div>
    </li>
  );
}

export function ExpenseList({
  expenses,
  currencyCode,
}: {
  expenses: PersonalExpense[];
  currencyCode: CurrencyCode;
}) {
  return (
    <div className="flex flex-col gap-6">
      {groupByDate(expenses).map(([date, items]) => (
        <section key={date} aria-labelledby={`day-${date}`}>
          <div className="mb-2 flex items-baseline justify-between gap-4 px-1">
            <h2
              id={`day-${date}`}
              className="text-sm font-medium text-muted-foreground"
            >
              {formatRelativeDate(date)}
            </h2>
            <span className="tabular text-xs text-muted-foreground">
              {formatMinorUnits(
                sumAmounts(items.map((item) => item.amount)),
                currencyCode,
              )}
            </span>
          </div>

          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {items.map((expense) => (
              <ExpenseRow
                key={expense.id}
                expense={expense}
                currencyCode={currencyCode}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
