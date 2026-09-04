import { Target } from "lucide-react";
import Link from "next/link";

import {
  BudgetMeter,
  BudgetStatusBadge,
} from "@/components/budgets/budget-meter";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { BudgetOverview } from "@/lib/budgets/queries";
import { formatMonthLabel } from "@/lib/dates";
import { formatMinorUnits } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { CurrencyCode } from "@/types";

/**
 * Category, budget, spent, remaining and utilisation (specification section 19).
 *
 * A real table, because this is tabular: five figures per category that people
 * read down a column to compare. Rows arrive already ordered by need — over
 * budget first, then nearing it — which `getBudgetOverview` decided, so the
 * categories wanting attention are at the top rather than the ones that happen
 * to start with "A".
 *
 * Categories with no budget and no spending are left out: they are neither a
 * result nor a warning, and the categories page is where the full list lives.
 *
 * On a narrow screen the table scrolls sideways inside its own container
 * rather than squeezing the page (section 41), and status is carried by a
 * worded badge as well as by the meter's colour (sections 16 and 40).
 */
export function BudgetTable({
  overview,
  currencyCode,
  /** Where budgets are set — the categories page for this owner. */
  manageHref,
  canManage,
}: {
  overview: BudgetOverview;
  currencyCode: CurrencyCode;
  manageHref: string;
  canManage: boolean;
}) {
  const monthLabel = formatMonthLabel(overview.month);

  const rows = overview.rows.filter(
    (row) => row.progress.budget !== null || row.progress.spent > 0,
  );

  const budgeted = rows.filter((row) => row.progress.budget !== null).length;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Target aria-hidden className="size-4 text-muted-foreground" />
            Budget vs actual
          </CardTitle>
          <CardDescription>
            {budgeted > 0
              ? `${monthLabel}, against ${budgeted} ${budgeted === 1 ? "budgeted category" : "budgeted categories"}.`
              : `${monthLabel}. No category has a budget yet.`}
          </CardDescription>
        </div>

        <Link
          href={manageHref}
          className={buttonVariants({ variant: "secondary", size: "sm" })}
        >
          {canManage ? "Set budgets" : "View budgets"}
        </Link>
      </CardHeader>

      <CardContent>
        {rows.length === 0 ? (
          <EmptyState
            icon={Target}
            title="Nothing to compare yet"
            description={
              canManage
                ? "Give a category a monthly budget, and this month's spending is measured against it here."
                : "Once a group admin sets category budgets, spending is measured against them here."
            }
            className="py-8"
          />
        ) : (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-125 border-collapse text-sm">
              <caption className="sr-only">
                Budget versus actual spending per category for {monthLabel}
              </caption>
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Category
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">
                    Budget
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">
                    Spent
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">
                    Remaining
                  </th>
                  <th scope="col" className="w-40 py-2 font-medium">
                    Used
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ category, progress }) => {
                  const over =
                    progress.remaining !== null && progress.remaining < 0;

                  return (
                    <tr key={category.id} className="border-b border-border last:border-0">
                      <th
                        scope="row"
                        className="py-3 pr-4 text-left font-medium break-words"
                      >
                        {category.name}
                        {category.is_archived ? (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            Archived
                          </span>
                        ) : null}
                      </th>
                      <td className="tabular py-3 pr-4 text-right">
                        {progress.budget === null
                          ? "—"
                          : formatMinorUnits(progress.budget, currencyCode)}
                      </td>
                      <td className="tabular py-3 pr-4 text-right">
                        {formatMinorUnits(progress.spent, currencyCode)}
                      </td>
                      <td
                        className={cn(
                          "tabular py-3 pr-4 text-right",
                          over && "font-medium text-danger-strong",
                        )}
                      >
                        {progress.remaining === null
                          ? "—"
                          : `${over ? "−" : ""}${formatMinorUnits(Math.abs(progress.remaining), currencyCode)}`}
                      </td>
                      <td className="py-3">
                        {progress.budget === null ? (
                          <span className="text-xs text-muted-foreground">
                            No budget set
                          </span>
                        ) : (
                          <div className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-2">
                              <span className="tabular text-xs font-medium">
                                {progress.used}%
                              </span>
                              <BudgetStatusBadge progress={progress} />
                            </div>
                            <BudgetMeter
                              progress={progress}
                              currencyCode={currencyCode}
                              label={category.name}
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {overview.uncategorised > 0 || overview.unbudgeted > 0 ? (
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
        ) : null}
      </CardContent>
    </Card>
  );
}
