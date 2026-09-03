import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DeleteExpenseButton } from "@/components/expenses/delete-expense-button";
import { ExpenseForm } from "@/components/expenses/expense-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FadeIn } from "@/components/ui/fade-in";
import { requireProfile } from "@/lib/auth/dal";
import { DEFAULT_CURRENCY_CODE } from "@/lib/constants";
import { formatTimestamp, todayIso } from "@/lib/dates";
import { updateExpense } from "@/lib/expenses/actions";
import {
  getPersonalExpense,
  listPersonalCategories,
} from "@/lib/expenses/queries";

export const metadata: Metadata = {
  title: "Edit expense",
};

export default async function EditExpensePage(
  props: PageProps<"/expenses/[id]/edit">,
) {
  const { id } = await props.params;
  const profile = await requireProfile();
  const expense = await getPersonalExpense(id);

  // Covers both "no such expense" and "not yours": `getPersonalExpense` only
  // ever returns this user's own personal rows.
  if (!expense) {
    notFound();
  }

  const categories = await listPersonalCategories();

  return (
    <FadeIn className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Edit expense</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Recorded on {formatTimestamp(expense.created_at)}.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Expense details</CardTitle>
          <CardDescription>
            Changes apply to your personal records only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ExpenseForm
            action={updateExpense.bind(null, expense.id)}
            categories={categories.filter(
              (category) =>
                !category.is_archived || category.id === expense.category_id,
            )}
            payerName={profile.name}
            currencyCode={DEFAULT_CURRENCY_CODE}
            serverToday={todayIso()}
            defaults={{
              itemName: expense.item_name,
              amount: expense.amount.toFixed(2),
              expenseDate: expense.expense_date,
              category: expense.category_id ?? "",
              paymentMode: expense.payment_mode ?? "",
              notes: expense.notes ?? "",
            }}
            submitLabel="Save changes"
            cancelHref="/expenses"
          />
        </CardContent>
      </Card>

      <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <p className="text-sm font-medium">Delete this expense</p>
          <p className="text-xs text-muted-foreground">
            This cannot be undone.
          </p>
        </div>
        <DeleteExpenseButton id={expense.id} itemName={expense.item_name} />
      </Card>
    </FadeIn>
  );
}
