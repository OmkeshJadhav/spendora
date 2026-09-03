import type { Metadata } from "next";

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
import { todayIso } from "@/lib/dates";
import { createExpense } from "@/lib/expenses/actions";
import { listPersonalCategories } from "@/lib/expenses/queries";

export const metadata: Metadata = {
  title: "Add expense",
};

export default async function NewExpensePage() {
  const profile = await requireProfile();
  const categories = await listPersonalCategories();

  return (
    <FadeIn className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Add expense</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Record what you spent. Only the first four fields are required.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Expense details</CardTitle>
          <CardDescription>
            This is a personal expense — nobody else can see it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ExpenseForm
            action={createExpense}
            categories={categories.filter((category) => !category.is_archived)}
            payerName={profile.name}
            currencyCode={DEFAULT_CURRENCY_CODE}
            serverToday={todayIso()}
            submitLabel="Save expense"
            cancelHref="/expenses"
          />
        </CardContent>
      </Card>
    </FadeIn>
  );
}
