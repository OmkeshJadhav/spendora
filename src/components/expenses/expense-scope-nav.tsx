import { CalendarRange, X } from "lucide-react";
import Link from "next/link";

import { MonthNav } from "@/components/month-nav";
import { buttonVariants } from "@/components/ui/button";
import { currentMonthKey, formatExpenseDate, monthParam } from "@/lib/dates";
import {
  filterParamsWithoutScope,
  monthScope,
  withParams,
  type ExpenseFilters,
} from "@/lib/expenses/filters";
import { cn } from "@/lib/utils";

/**
 * The time scope above an expense list (specification sections 23 and 58).
 *
 * A list can be scoped three ways, and which control is showing says which one
 * is in force, so the two can never appear to contradict each other:
 *
 *  - **A month** — `‹ September 2026 ›`, the historical-records control. Set by
 *    these arrows, or by arriving from the dashboard's chart.
 *  - **A custom range** — whatever the filter bar's From/To were set to.
 *  - **All time** — the default, which is what a list of "my expenses" means
 *    before anyone has narrowed it.
 *
 * `MonthNav` is reused rather than reimplemented: it already carries the other
 * filters across a month change, disables arrows at the ends of the allowed
 * window, and announces the month it moved to.
 */
export function ExpenseScopeNav({
  basePath,
  filters,
  className,
}: {
  basePath: string;
  filters: ExpenseFilters;
  className?: string;
}) {
  const month = monthScope(filters);
  // The month navigator sets `month`, so it must not carry the `from`/`to` it
  // is replacing — those take precedence and the arrows would do nothing.
  const params = filterParamsWithoutScope(filters);

  if (month) {
    return (
      <div className={cn("flex flex-wrap items-center gap-2", className)}>
        <MonthNav month={month} basePath={basePath} params={params} />
        <Link
          href={withParams(basePath, params)}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          All time
        </Link>
      </div>
    );
  }

  const thisMonth = withParams(basePath, {
    ...params,
    month: monthParam(currentMonthKey()),
  });

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <p className="flex items-center gap-2 text-sm font-medium">
        <CalendarRange aria-hidden className="size-4 text-muted-foreground" />
        {rangeLabel(filters)}
      </p>

      {filters.from || filters.to ? (
        <Link
          href={withParams(basePath, params)}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          <X aria-hidden />
          Clear dates
        </Link>
      ) : null}

      <Link
        href={thisMonth}
        className={buttonVariants({ variant: "secondary", size: "sm" })}
      >
        This month
      </Link>
    </div>
  );
}

/** Either end of a range may stand alone, and each reads differently. */
function rangeLabel({ from, to }: ExpenseFilters): string {
  if (from && to) {
    return `${formatExpenseDate(from)} – ${formatExpenseDate(to)}`;
  }

  if (from) {
    return `From ${formatExpenseDate(from)}`;
  }

  if (to) {
    return `Up to ${formatExpenseDate(to)}`;
  }

  return "All time";
}
