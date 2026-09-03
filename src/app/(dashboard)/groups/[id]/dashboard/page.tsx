import type { Metadata } from "next";
import { Plus, ReceiptText } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BudgetTable } from "@/components/dashboard/budget-table";
import { CategoryBreakdown } from "@/components/dashboard/category-breakdown";
import { MemberSpending } from "@/components/dashboard/member-spending";
import { MonthlyTrend } from "@/components/dashboard/monthly-trend";
import { MonthSummary } from "@/components/dashboard/month-summary";
import { ExpenseList } from "@/components/expenses/expense-list";
import { GroupExpenseActions } from "@/components/expenses/group-expense-actions";
import { GroupContext } from "@/components/groups/group-context";
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
import { requireUser } from "@/lib/auth/dal";
import { getGroupDashboard } from "@/lib/dashboard/queries";
import { formatMonthLabel, resolveMonth } from "@/lib/dates";
import { getGroupDetail } from "@/lib/groups/queries";

export const metadata: Metadata = {
  title: "Group dashboard",
};

/**
 * The group dashboard (specification sections 18-21).
 *
 * Visible to admins and members alike — everything here is a read, and a
 * member is entitled to every figure on it. The one thing that differs by role
 * is who may edit an expense row and whether the budget link offers to set
 * budgets or only to read them; both come from `isAdmin`, and both are backed
 * by policies rather than by the absence of a button.
 */
export default async function GroupDashboardPage(
  props: PageProps<"/groups/[id]/dashboard">,
) {
  const { id } = await props.params;
  await requireUser();

  const detail = await getGroupDetail(id);

  // Covers both "no such group" and "not a member of it": RLS returns nothing
  // in either case, and the two should be indistinguishable from outside.
  if (!detail) {
    notFound();
  }

  const searchParams = await props.searchParams;
  const month = resolveMonth(
    Array.isArray(searchParams.month) ? searchParams.month[0] : searchParams.month,
  );

  const { group, role, isAdmin } = detail;
  const dashboard = await getGroupDashboard(group.id, month, isAdmin);

  const basePath = `/groups/${group.id}/dashboard`;
  const monthLabel = formatMonthLabel(month);
  const hasAnyExpenses =
    dashboard.recent.length > 0 ||
    dashboard.trend.some((point) => point.count > 0);

  return (
    <FadeIn className="flex flex-col gap-6">
      <GroupContext
        groupId={group.id}
        name={group.name}
        description={group.description}
        currencyCode={group.currency_code}
        role={role}
        backHref={`/groups/${group.id}`}
        backLabel="Back to group"
        showCategories
        showSettings={isAdmin}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          What this group spent in {monthLabel}.
        </p>

        <Link
          href={`/groups/${group.id}/expenses/new`}
          className={buttonVariants({ size: "sm" })}
        >
          <Plus aria-hidden />
          Add expense
        </Link>
      </div>

      <MonthNav month={month} basePath={basePath} />

      {!hasAnyExpenses ? (
        <Card>
          <EmptyState
            icon={ReceiptText}
            title="No expenses yet"
            description="Once someone in this group records an expense, this dashboard shows the monthly total, budgets, category spending and who paid what."
            action={
              <Link
                href={`/groups/${group.id}/expenses/new`}
                className={buttonVariants()}
              >
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
            currencyCode={group.currency_code}
          />

          <MonthlyTrend
            points={dashboard.trend}
            currencyCode={group.currency_code}
            basePath={basePath}
          />

          <div className="grid gap-6 lg:grid-cols-2">
            <CategoryBreakdown
              categories={dashboard.categories}
              currencyCode={group.currency_code}
              month={month}
              categoriesHref={`/groups/${group.id}/categories`}
            />

            <MemberSpending
              members={dashboard.members}
              currencyCode={group.currency_code}
              month={month}
            />
          </div>

          <BudgetTable
            overview={dashboard.overview}
            currencyCode={group.currency_code}
            manageHref={`/groups/${group.id}/categories`}
            canManage={isAdmin}
          />

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base text-foreground">
                  <ReceiptText
                    aria-hidden
                    className="size-4 text-muted-foreground"
                  />
                  Recent expenses
                </CardTitle>
                <CardDescription>
                  The group&rsquo;s latest records, whichever month they fall in.
                </CardDescription>
              </div>
              <Link
                href={`/groups/${group.id}/expenses`}
                className="rounded-md text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                View all
              </Link>
            </CardHeader>
            <CardContent>
              <ExpenseList
                expenses={dashboard.recent}
                currencyCode={group.currency_code}
                paidByName={(expense) => expense.paidByName}
                actions={(expense) => (
                  <GroupExpenseActions
                    groupId={group.id}
                    expenseId={expense.id}
                    itemName={expense.item_name}
                    canEdit={expense.canEdit}
                  />
                )}
              />
            </CardContent>
          </Card>
        </>
      )}
    </FadeIn>
  );
}
