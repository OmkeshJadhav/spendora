import type { Metadata } from "next";
import { Plus, ReceiptText, TrendingUp, Wallet } from "lucide-react";
import Link from "next/link";

import { CategoryBreakdown } from "@/components/dashboard/category-breakdown";
import { StatCard } from "@/components/dashboard/stat-card";
import { AddExpenseFab } from "@/components/expenses/add-expense-fab";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FadeIn } from "@/components/ui/fade-in";
import { requireProfile } from "@/lib/auth/dal";
import { DEFAULT_CURRENCY_CODE } from "@/lib/constants";
import { currentMonthKey, elapsedDaysInMonth, formatMonthLabel } from "@/lib/dates";
import {
  getPersonalMonthSummary,
  listRecentPersonalExpenses,
} from "@/lib/expenses/queries";
import { formatCurrency, formatMinorUnits } from "@/lib/money";

export const metadata: Metadata = {
  title: "Dashboard",
};

const RECENT_LIMIT = 5;

export default async function DashboardPage() {
  const profile = await requireProfile();
  const month = currentMonthKey();

  const [summary, recent] = await Promise.all([
    getPersonalMonthSummary(month),
    listRecentPersonalExpenses(RECENT_LIMIT),
  ]);

  const monthLabel = formatMonthLabel(month);
  const elapsed = elapsedDaysInMonth(month);
  const hasAnyExpenses = recent.length > 0;

  return (
    <FadeIn className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome, {profile.name}
          </h1>
          {/* The month in view is stated up front (specification section 58). */}
          <p className="mt-1 text-sm text-muted-foreground">
            Your personal spending for {monthLabel}.
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

      {!hasAnyExpenses ? (
        <Card>
          <EmptyState
            icon={Wallet}
            title="No expenses yet"
            description="Add your first expense and this dashboard will show your monthly total, category breakdown and recent activity."
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
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              title="Total spent"
              value={formatMinorUnits(summary.total, DEFAULT_CURRENCY_CODE)}
              hint={monthLabel}
              icon={Wallet}
            />
            <StatCard
              title="Expenses"
              value={String(summary.count)}
              hint={summary.count === 1 ? "record" : "records"}
              icon={ReceiptText}
            />
            <StatCard
              title="Average daily"
              value={formatMinorUnits(
                summary.averageDaily,
                DEFAULT_CURRENCY_CODE,
              )}
              hint={`Over ${elapsed} ${elapsed === 1 ? "day" : "days"} so far`}
              icon={TrendingUp}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Spending by category</CardTitle>
              </CardHeader>
              <CardContent>
                {summary.categories.length > 0 ? (
                  <CategoryBreakdown
                    categories={summary.categories}
                    currencyCode={DEFAULT_CURRENCY_CODE}
                  />
                ) : (
                  <p className="py-4 text-sm text-muted-foreground">
                    No expenses recorded for {monthLabel}.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>Recent expenses</CardTitle>
                <Link
                  href="/expenses"
                  className="text-sm font-medium text-primary hover:underline rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  View all
                </Link>
              </CardHeader>
              <CardContent className="text-sm">
                <ul className="divide-y divide-border">
                  {recent.map((expense) => (
                    <li
                      key={expense.id}
                      className="flex items-center justify-between gap-4 py-2.5"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {expense.item_name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {expense.category?.name ?? "Uncategorised"}
                        </span>
                      </span>
                      <span className="tabular shrink-0 font-medium">
                        {formatCurrency(expense.amount, DEFAULT_CURRENCY_CODE)}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <AddExpenseFab />
    </FadeIn>
  );
}
