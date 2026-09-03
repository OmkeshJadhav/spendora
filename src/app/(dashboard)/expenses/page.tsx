import type { Metadata } from "next";
import { Plus, ReceiptText } from "lucide-react";
import Link from "next/link";

import { FlashToast } from "@/components/flash-toast";
import { AddExpenseFab } from "@/components/expenses/add-expense-fab";
import { ExpenseList } from "@/components/expenses/expense-list";
import { ExpensePagination } from "@/components/expenses/expense-pagination";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FadeIn } from "@/components/ui/fade-in";
import { requireUser } from "@/lib/auth/dal";
import { DEFAULT_CURRENCY_CODE } from "@/lib/constants";
import { listPersonalExpenses } from "@/lib/expenses/queries";

export const metadata: Metadata = {
  title: "Expenses",
};

function pageNumber(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export default async function ExpensesPage(props: PageProps<"/expenses">) {
  await requireUser();

  const searchParams = await props.searchParams;
  const { expenses, total, page, pageCount } = await listPersonalExpenses(
    pageNumber(searchParams.page),
  );

  const flash = Array.isArray(searchParams.flash)
    ? searchParams.flash[0]
    : searchParams.flash;

  return (
    <FadeIn className="flex flex-col gap-6">
      <FlashToast flash={flash} path="/expenses" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Expenses</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your personal expenses. Only you can see them.
          </p>
        </div>

        <Link
          href="/expenses/new"
          className={`${buttonVariants({ size: "md" })} hidden sm:inline-flex`}
        >
          <Plus aria-hidden />
          Add expense
        </Link>
      </div>

      {expenses.length === 0 ? (
        <Card>
          <EmptyState
            icon={ReceiptText}
            title="No expenses yet"
            description="Start tracking your spending by adding your first expense."
            action={
              <Link href="/expenses/new" className={buttonVariants()}>
                <Plus aria-hidden />
                Add expense
              </Link>
            }
          />
        </Card>
      ) : (
        <>
          <ExpenseList
            expenses={expenses}
            currencyCode={DEFAULT_CURRENCY_CODE}
          />
          <ExpensePagination page={page} pageCount={pageCount} total={total} />
        </>
      )}

      <AddExpenseFab />
    </FadeIn>
  );
}
