import type { Metadata } from "next";
import { Plus, ReceiptText, Wallet } from "lucide-react";
import Link from "next/link";

import { BudgetTable } from "@/components/dashboard/budget-table";
import { CategoryBreakdown } from "@/components/dashboard/category-breakdown";
import { MonthlyTrend } from "@/components/dashboard/monthly-trend";
import { MonthSummary } from "@/components/dashboard/month-summary";
import { AddExpenseFab } from "@/components/expenses/add-expense-fab";
import { ExpenseList } from "@/components/expenses/expense-list";
import { MonthNav } from "@/components/month-nav";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FadeIn } from "@/components/ui/fade-in";
import { PageHeader } from "@/components/ui/page-header";
import { requireProfile } from "@/lib/auth/dal";
import { DEFAULT_CURRENCY_CODE } from "@/lib/constants";
import { getPersonalDashboard } from "@/lib/dashboard/queries";
import { formatMonthLabel, monthParam, resolveMonth } from "@/lib/dates";

export const metadata: Metadata = {
  title: "Dashboard",
};

const BASE_PATH = "/dashboard";

/**
 * The personal dashboard (specification section 17).
 *
 * Private by construction: every figure comes from `getPersonalDashboard`,
 * which reads only rows with `group_id is null` belonging to the signed-in
 * user, on top of RLS that would return nothing else anyway.
 *
 * The month is a URL parameter rather than client state, so this view is
 * linkable, the back button steps through months, and the whole page works
 * with no JavaScript.
 */
export default async function DashboardPage(props: PageProps<"/dashboard">) {
  const profile = await requireProfile();
  const searchParams = await props.searchParams;

  const month = resolveMonth(
    Array.isArray(searchParams.month) ? searchParams.month[0] : searchParams.month,
  );

  const dashboard = await getPersonalDashboard(month);
  const monthLabel = formatMonthLabel(month);

  // "Has this person ever recorded anything?", not "did they spend this
  // month?" — an empty September for somebody with two years of history
  // should show an empty September, not a first-run welcome.
  const hasAnyExpenses =
    dashboard.recent.length > 0 ||
    dashboard.trend.some((point) => point.count > 0);

  return (
    <FadeIn className="flex flex-col gap-6">
      {/* The month in view is stated up front (specification section 58). */}
      <PageHeader
        title={`Welcome, ${profile.name}`}
        description={`Your personal spending for ${monthLabel}.`}
        action={
          <Link
            href="/expenses/new"
            className={`${buttonVariants({ size: "md" })} hidden sm:inline-flex`}
          >
            <Plus aria-hidden />
            Add expense
          </Link>
        }
      />

      {/* The month reaches the expense list too, so "historical records"
          (specification section 23) is one link rather than a second search. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthNav month={month} basePath={BASE_PATH} />

        <Link
          href={`/expenses?month=${monthParam(month)}`}
          aria-label={`View expenses for ${monthLabel}`}
          className="rounded-md text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          View expenses
        </Link>
      </div>

      {!hasAnyExpenses ? (
        <Card>
          <EmptyState
            icon={Wallet}
            title="No expenses yet"
            description="Add your first expense and this dashboard will show your monthly total, category breakdown, budgets and spending trend."
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
          <MonthSummary
            overview={dashboard.overview}
            averageDaily={dashboard.averageDaily}
            currencyCode={DEFAULT_CURRENCY_CODE}
          />

          <MonthlyTrend
            points={dashboard.trend}
            currencyCode={DEFAULT_CURRENCY_CODE}
            basePath={BASE_PATH}
          />

          <div className="grid gap-6 lg:grid-cols-2">
            <CategoryBreakdown
              categories={dashboard.categories}
              currencyCode={DEFAULT_CURRENCY_CODE}
              month={month}
              categoriesHref="/categories"
            />

            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <ReceiptText
                      aria-hidden
                      className="size-4 text-muted-foreground"
                    />
                    Recent expenses
                  </CardTitle>
                  <CardDescription>
                    Your latest records, whichever month they fall in.
                  </CardDescription>
                </div>
                <Link
                  href="/expenses"
                  className="rounded-md text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  View all
                </Link>
              </CardHeader>
              <CardContent>
                <ExpenseList
                  expenses={dashboard.recent}
                  currencyCode={DEFAULT_CURRENCY_CODE}
                  headingLevel="h3"
                />
              </CardContent>
            </Card>
          </div>

          <BudgetTable
            overview={dashboard.overview}
            currencyCode={DEFAULT_CURRENCY_CODE}
            manageHref="/categories"
            canManage
          />
        </>
      )}

      <AddExpenseFab />
    </FadeIn>
  );
}
