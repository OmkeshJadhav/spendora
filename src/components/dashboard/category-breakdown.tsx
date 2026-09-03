import { PieChart } from "lucide-react";
import Link from "next/link";

import { BarList, type BarItem } from "@/components/charts/bar-list";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { CategoryTotal } from "@/lib/dashboard/summary";
import { formatMonthLabel } from "@/lib/dates";
import type { CurrencyCode, MonthKey } from "@/types";

/**
 * Where the month's money went (specification section 17).
 *
 * A ranked bar list rather than the donut section 38 suggests. The dataviz
 * rule this follows is that a categorical palette only clears its
 * colour-blindness gates for about three slices at once, and a real month has
 * more categories than that — a six-slice donut would be telling people apart
 * by colours several of them cannot distinguish. Ranked bars carry the same
 * part-to-whole reading with the amounts and shares printed as text, in the
 * order that answers the actual question: what did I spend most on?
 */
export function CategoryBreakdown({
  categories,
  currencyCode,
  month,
  /** Where the full list of categories and their budgets is managed. */
  categoriesHref,
}: {
  categories: CategoryTotal[];
  currencyCode: CurrencyCode;
  month: MonthKey;
  categoriesHref: string;
}) {
  const monthLabel = formatMonthLabel(month);

  const items: BarItem[] = categories.map((category) => ({
    key: category.key,
    label: category.name,
    value: category.total,
    share: category.share,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base text-foreground">
          <PieChart aria-hidden className="size-4 text-muted-foreground" />
          Spending by category
        </CardTitle>
        <CardDescription>
          {categories.length > 0
            ? `Share of ${monthLabel}, largest first.`
            : `Nothing was spent in ${monthLabel}.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {categories.length > 0 ? (
          <>
            <BarList items={items} currencyCode={currencyCode} />
            <Link
              href={categoriesHref}
              className="mt-4 inline-block rounded-md text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              Categories &amp; budgets
            </Link>
          </>
        ) : (
          <EmptyState
            icon={PieChart}
            title={`No expenses in ${monthLabel}`}
            description="Once expenses are recorded for this month, they appear here broken down by category."
            className="py-8"
          />
        )}
      </CardContent>
    </Card>
  );
}
