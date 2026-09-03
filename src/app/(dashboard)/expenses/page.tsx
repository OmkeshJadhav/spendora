import type { Metadata } from "next";
import { Plus, ReceiptText, SearchX } from "lucide-react";
import Link from "next/link";

import { FlashToast } from "@/components/flash-toast";
import { AddExpenseFab } from "@/components/expenses/add-expense-fab";
import { ExpenseFilterBar } from "@/components/expenses/expense-filters";
import { ExpenseList } from "@/components/expenses/expense-list";
import { ExpensePagination } from "@/components/expenses/expense-pagination";
import { ExpenseScopeNav } from "@/components/expenses/expense-scope-nav";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FadeIn } from "@/components/ui/fade-in";
import { requireUser } from "@/lib/auth/dal";
import { DEFAULT_CURRENCY_CODE } from "@/lib/constants";
import { formatMonthLabel } from "@/lib/dates";
import {
  filterParams,
  hasActiveFilters,
  monthScope,
  parseExpenseFilters,
} from "@/lib/expenses/filters";
import {
  listPersonalCategories,
  listPersonalExpenses,
} from "@/lib/expenses/queries";
import { formatMinorUnits } from "@/lib/money";

export const metadata: Metadata = {
  title: "Expenses",
};

const BASE_PATH = "/expenses";

function pageNumber(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * The personal expense list, with search, filters and history (sections 22-24).
 *
 * Everything that narrows the list lives in the query string, so a search is
 * shareable, the back button undoes it, and the whole page still works with no
 * JavaScript. Unfiltered, the list is all time rather than this month: a list
 * called "Expenses" that quietly hid August would be the wrong default, and
 * the month is one click away on the scope navigator.
 */
export default async function ExpensesPage(props: PageProps<"/expenses">) {
  await requireUser();

  const searchParams = await props.searchParams;
  const filters = parseExpenseFilters(searchParams);
  const filtered = hasActiveFilters(filters);
  const month = monthScope(filters);

  const [{ expenses, total, page, pageCount, filteredTotal }, categories] =
    await Promise.all([
      listPersonalExpenses({ page: pageNumber(searchParams.page), filters }),
      listPersonalCategories(),
    ]);

  const flash = Array.isArray(searchParams.flash)
    ? searchParams.flash[0]
    : searchParams.flash;

  return (
    <FadeIn className="flex flex-col gap-6">
      <FlashToast flash={flash} path={BASE_PATH} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Expenses</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {filtered
              ? `${total} matching ${total === 1 ? "expense" : "expenses"}, totalling ${formatMinorUnits(filteredTotal, DEFAULT_CURRENCY_CODE)}.`
              : "Your personal expenses. Only you can see them."}
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

      {/* The controls are only worth the space once there is something to
          narrow — but they stay put while a filter is active, otherwise
          clearing one would mean going back rather than pressing "Clear". */}
      {total > 0 || filtered ? (
        <>
          <ExpenseScopeNav basePath={BASE_PATH} filters={filters} />
          <ExpenseFilterBar
            basePath={BASE_PATH}
            filters={filters}
            categories={categories.filter((category) => !category.is_archived)}
          />
        </>
      ) : null}

      {expenses.length === 0 ? (
        <Card>
          {filtered ? (
            <EmptyState
              icon={SearchX}
              title={
                month
                  ? `No expenses recorded for ${formatMonthLabel(month)}`
                  : "No expenses match your search"
              }
              description="Try widening the search, or clear it to see everything you have recorded."
              action={
                <Link href={BASE_PATH} className={buttonVariants()}>
                  Clear all
                </Link>
              }
            />
          ) : (
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
          )}
        </Card>
      ) : (
        <>
          <ExpenseList
            expenses={expenses}
            currencyCode={DEFAULT_CURRENCY_CODE}
          />
          <ExpensePagination
            page={page}
            pageCount={pageCount}
            total={total}
            basePath={BASE_PATH}
            query={filterParams(filters)}
          />
        </>
      )}

      <AddExpenseFab />
    </FadeIn>
  );
}
