import { TrendingUp } from "lucide-react";

import { ColumnChart } from "@/components/charts/column-chart";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { TrendPoint } from "@/lib/dashboard/summary";
import { formatMonthShort } from "@/lib/dates";
import type { CurrencyCode } from "@/types";

/**
 * Monthly expenditure (specification section 20).
 *
 * Shown even when the selected month is empty, because the point of a trend is
 * the months either side of the one in view. It collapses to an empty state
 * only when the whole window is empty — there is no trend in six zeroes.
 */
export function MonthlyTrend({
  points,
  currencyCode,
  basePath,
}: {
  points: TrendPoint[];
  currencyCode: CurrencyCode;
  basePath: string;
}) {
  const hasSpending = points.some((point) => point.total > 0);
  const from = points[0];
  const to = points[points.length - 1];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp aria-hidden className="size-4 text-muted-foreground" />
          Monthly expenditure
        </CardTitle>
        <CardDescription>
          {formatMonthShort(from.month, true)} to{" "}
          {formatMonthShort(to.month, true)}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {hasSpending ? (
          <ColumnChart
            points={points}
            currencyCode={currencyCode}
            basePath={basePath}
          />
        ) : (
          <EmptyState
            icon={TrendingUp}
            title="No spending in these months"
            description="Record a few expenses and the trend across recent months builds up here."
            className="py-8"
          />
        )}
      </CardContent>
    </Card>
  );
}
