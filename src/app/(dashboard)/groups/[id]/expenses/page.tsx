import type { Metadata } from "next";
import { Plus, ReceiptText, SearchX } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AddExpenseFab } from "@/components/expenses/add-expense-fab";
import { ExpenseFilterBar } from "@/components/expenses/expense-filters";
import { ExpenseList } from "@/components/expenses/expense-list";
import { ExpensePagination } from "@/components/expenses/expense-pagination";
import { ExpenseScopeNav } from "@/components/expenses/expense-scope-nav";
import { ExportMenu } from "@/components/expenses/export-menu";
import { GroupExpenseActions } from "@/components/expenses/group-expense-actions";
import { FlashToast } from "@/components/flash-toast";
import { GroupContext } from "@/components/groups/group-context";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FadeIn } from "@/components/ui/fade-in";
import { requireUser } from "@/lib/auth/dal";
import { formatMonthLabel } from "@/lib/dates";
import {
  filterParams,
  hasActiveFilters,
  monthScope,
  parseExpenseFilters,
} from "@/lib/expenses/filters";
import {
  listGroupCategories,
  listGroupExpenses,
} from "@/lib/expenses/group-queries";
import { getGroupDetail } from "@/lib/groups/queries";
import { formatMinorUnits } from "@/lib/money";

export const metadata: Metadata = {
  title: "Group expenses",
};

function pageNumber(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export default async function GroupExpensesPage(
  props: PageProps<"/groups/[id]/expenses">,
) {
  const { id } = await props.params;
  await requireUser();

  const detail = await getGroupDetail(id);

  // Covers both "no such group" and "not a member of it": RLS returns nothing
  // in either case, and the two should be indistinguishable from outside.
  if (!detail) {
    notFound();
  }

  const { group, role, isAdmin, members } = detail;
  const searchParams = await props.searchParams;
  const filters = parseExpenseFilters(searchParams);
  const filtered = hasActiveFilters(filters);
  const month = monthScope(filters);

  const [{ expenses, total, page, pageCount, filteredTotal }, categories] =
    await Promise.all([
      listGroupExpenses(group.id, {
        page: pageNumber(searchParams.page),
        filters,
        isAdmin,
      }),
      listGroupCategories(group.id),
    ]);

  const flash = Array.isArray(searchParams.flash)
    ? searchParams.flash[0]
    : searchParams.flash;

  const basePath = `/groups/${group.id}/expenses`;
  const payers = members.map((member) => ({
    id: member.user_id,
    name: member.profile?.name ?? "Former member",
    isSelf: member.isSelf,
  }));

  return (
    <FadeIn className="flex flex-col gap-6">
      <FlashToast flash={flash} path={basePath} />

      <GroupContext
        groupId={group.id}
        name={group.name}
        description={null}
        currencyCode={group.currency_code}
        role={role}
        backHref={`/groups/${group.id}`}
        backLabel="Back to group"
        showDashboard
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Expenses</h2>
          {/* Same `data-slot` the page headers carry: this is the list's
              summary line, and the suites match it by role, not by class. */}
          <p
            data-slot="page-description"
            className="mt-1 text-sm text-muted-foreground"
          >
            {filtered
              ? `${total} matching ${total === 1 ? "expense" : "expenses"}, totalling ${formatMinorUnits(filteredTotal, group.currency_code)}.`
              : `${total} ${total === 1 ? "expense" : "expenses"}, totalling ${formatMinorUnits(filteredTotal, group.currency_code)}.`}
          </p>
        </div>

        <Link
          href={`/groups/${group.id}/expenses/new`}
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ExpenseScopeNav basePath={basePath} filters={filters} />
            <ExportMenu
              basePath={`/api/groups/${group.id}/expenses/export`}
              filters={filters}
            />
          </div>
          <ExpenseFilterBar
            basePath={basePath}
            filters={filters}
            categories={categories.filter((category) => !category.is_archived)}
            members={payers}
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
                  : "No expenses match these filters"
              }
              description="Try widening them, or clear them to see everything in this group."
              action={
                <Link href={basePath} className={buttonVariants()}>
                  Clear all
                </Link>
              }
            />
          ) : (
            <EmptyState
              icon={ReceiptText}
              title="No expenses yet"
              description="Record what this group has spent. Everyone in the group can see and add expenses."
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
          )}
        </Card>
      ) : (
        <>
          <ExpenseList
            expenses={expenses}
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
          <ExpensePagination
            page={page}
            pageCount={pageCount}
            total={total}
            basePath={basePath}
            query={filterParams(filters)}
          />
        </>
      )}

      <AddExpenseFab href={`/groups/${group.id}/expenses/new`} />
    </FadeIn>
  );
}
