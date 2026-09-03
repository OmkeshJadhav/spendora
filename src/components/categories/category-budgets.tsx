import { PiggyBank, Tags, Wallet } from "lucide-react";

import { BudgetMeter } from "@/components/budgets/budget-meter";
import { AddCategoryForm } from "@/components/categories/add-category-form";
import { CategoryRow } from "@/components/categories/category-row";
import { SuggestedCategories } from "@/components/categories/suggested-categories";
import { MonthNav } from "@/components/month-nav";
import { StatCard } from "@/components/dashboard/stat-card";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  addDefaultCategories,
  archiveCategory,
  createCategory,
  deleteCategory,
  renameCategory,
  restoreCategory,
} from "@/lib/categories/actions";
import { categoriesPath, type CategoryOwner } from "@/lib/categories/owner";
import { unusedDefaults } from "@/lib/categories/queries";
import { clearBudget, setBudget } from "@/lib/budgets/actions";
import type { BudgetOverview } from "@/lib/budgets/queries";
import { budgetProgress } from "@/lib/budgets/status";
import { DEFAULT_CATEGORIES } from "@/lib/constants";
import { formatMonthLabel } from "@/lib/dates";
import { formatMinorUnits } from "@/lib/money";
import type { CurrencyCode } from "@/types";

/**
 * Categories and their monthly budgets, for a personal area or for a group
 * (specification sections 13-16 and 19).
 *
 * One component serves both, because they differ only in who owns the rows and
 * who may change them. This is also where the Server Actions are bound to
 * their group — a Server Component is the only safe place to do that, so
 * everything below this line receives actions rather than creating them.
 */
export function CategoryBudgets({
  owner,
  overview,
  currencyCode,
  canManage,
  /** Explains who may manage these, in the reader's own terms. */
  manageHint,
}: {
  owner: CategoryOwner;
  overview: BudgetOverview;
  currencyCode: CurrencyCode;
  canManage: boolean;
  manageHint: string;
}) {
  const groupId = owner.kind === "group" ? owner.groupId : null;
  const basePath = categoriesPath(owner);
  const monthLabel = formatMonthLabel(overview.month);

  const actions = {
    setBudget: setBudget.bind(null, groupId),
    clearBudget: clearBudget.bind(null, groupId),
    rename: renameCategory.bind(null, groupId),
    archive: archiveCategory.bind(null, groupId),
    restore: restoreCategory.bind(null, groupId),
    remove: deleteCategory.bind(null, groupId),
  };

  const { totals } = overview;
  // The month as a whole, expressed the same way a single category is, so the
  // summary bar and the category bars mean the same thing.
  const monthProgress = budgetProgress(
    totals.spent,
    totals.hasBudget ? totals.budget : null,
  );

  const suggestions = unusedDefaults(
    overview.rows.map((row) => row.category),
    DEFAULT_CATEGORIES,
  );

  return (
    <div className="flex flex-col gap-6">
      <MonthNav month={overview.month} basePath={basePath} />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          title="Total budget"
          value={
            totals.hasBudget
              ? formatMinorUnits(totals.budget, currencyCode)
              : "Not set"
          }
          hint={totals.hasBudget ? `Monthly, across ${budgetedCount(overview)}` : "Set one below"}
          icon={PiggyBank}
        />
        <StatCard
          title="Spent"
          value={formatMinorUnits(totals.spent, currencyCode)}
          hint={`${monthLabel} · ${overview.expenseCount} ${overview.expenseCount === 1 ? "expense" : "expenses"}`}
          icon={Wallet}
        />
        <StatCard
          title={totals.remaining < 0 ? "Over budget" : "Remaining"}
          value={
            totals.hasBudget
              ? formatMinorUnits(Math.abs(totals.remaining), currencyCode)
              : "—"
          }
          hint={
            totals.hasBudget
              ? `${totals.used}% of the budget used`
              : "Available once a budget is set"
          }
          icon={Tags}
        />
      </div>

      {totals.hasBudget ? (
        <BudgetMeter
          progress={monthProgress}
          currencyCode={currencyCode}
          label={`${monthLabel} overall`}
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-foreground">
            Categories and budgets
          </CardTitle>
          <CardDescription>
            Budgets are monthly and carry over to every month until you change
            them. Spending shown is for {monthLabel}. {manageHint}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {overview.rows.length === 0 ? (
            <EmptyState
              icon={Tags}
              title="No categories yet"
              description={
                canManage
                  ? "Add the categories you want to track, then give each one a monthly budget."
                  : "A group admin has not added any categories yet."
              }
              className="py-8"
            />
          ) : (
            <ul className="divide-y divide-border">
              {overview.rows.map((row) => (
                <CategoryRow
                  key={row.category.id}
                  row={row}
                  currencyCode={currencyCode}
                  canManage={canManage}
                  actions={actions}
                />
              ))}
            </ul>
          )}

          {(overview.uncategorised > 0 || overview.unbudgeted > 0) && (
            <div className="mt-4 flex flex-col gap-1 rounded-md bg-muted p-3 text-xs text-muted-foreground">
              {overview.uncategorised > 0 ? (
                <p>
                  <span className="tabular font-medium text-foreground">
                    {formatMinorUnits(overview.uncategorised, currencyCode)}
                  </span>{" "}
                  was spent with no category, so no budget covers it.
                </p>
              ) : null}
              {overview.unbudgeted > 0 ? (
                <p>
                  <span className="tabular font-medium text-foreground">
                    {formatMinorUnits(overview.unbudgeted, currencyCode)}
                  </span>{" "}
                  was spent in categories that have no budget.
                </p>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-foreground">
              Add a category
            </CardTitle>
            <CardDescription>
              Categories group spending and are what budgets are set against.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <AddCategoryForm
              action={createCategory.bind(null, groupId)}
              hint={
                owner.kind === "group"
                  ? "Everyone in this group can use it when adding an expense."
                  : "Only you can see and use your personal categories."
              }
            />

            <SuggestedCategories
              action={addDefaultCategories.bind(null, groupId)}
              suggestions={suggestions}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

/** "3 categories" — what the total budget is spread across. */
function budgetedCount(overview: BudgetOverview): string {
  const count = overview.rows.filter((row) => row.progress.budget !== null).length;

  return `${count} ${count === 1 ? "category" : "categories"}`;
}
