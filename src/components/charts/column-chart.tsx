import Link from "next/link";

import type { TrendPoint } from "@/lib/dashboard/summary";
import { formatMonthLabel, formatMonthShort, monthParam } from "@/lib/dates";
import { formatCompactMinorUnits, formatMinorUnits } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { CurrencyCode } from "@/types";

/**
 * Monthly expenditure over a trailing window (specification sections 20, 38).
 *
 * One series, one hue, with the month currently being viewed in the full
 * accent and the rest in a lighter step of it — emphasis rather than a
 * categorical palette, because the months are one measure over time and not
 * distinct series to tell apart.
 *
 * Every column is a link to that month, so the chart is also the fastest way
 * to move through history (section 23). Plain anchors: the month lives in the
 * URL, so this works with no JavaScript and the back button behaves.
 *
 * Values are labelled selectively — the highest column and the one in view —
 * because a number over every column is noise. The rest are reachable by
 * hovering a column, and every column carries its month and exact amount as
 * visually hidden text, so a screen reader reads the whole series in order and
 * nothing is gated behind seeing the chart.
 */
export function ColumnChart({
  points,
  currencyCode,
  /** Page the columns navigate within, e.g. `/dashboard`. */
  basePath,
  className,
}: {
  points: TrendPoint[];
  currencyCode: CurrencyCode;
  basePath: string;
  className?: string;
}) {
  // The tallest column sets the scale, and is also the one that earns a value
  // label. A month equal to it earns one too, which is the honest outcome.
  const max = points.reduce((largest, point) => Math.max(largest, point.total), 0);

  return (
    <figure className={cn("flex flex-col gap-3", className)}>
      <ol className="flex items-end gap-2 border-b border-border pb-2">
        {points.map((point, index) => {
          const label = formatMonthLabel(point.month);
          const amount = formatMinorUnits(point.total, currencyCode);
          // Scaled against the tallest column. A month with nothing in it
          // keeps a hairline, so the gap reads as zero rather than as missing.
          const height = max > 0 ? Math.max((point.total / max) * 100, 1) : 1;
          // The first column and every January say their year, so a window
          // that crosses one is never ambiguous.
          const withYear = index === 0 || point.month.month === 1;
          const labelled =
            point.total > 0 && (point.isSelected || point.total === max);

          return (
            <li key={`${point.month.year}-${point.month.month}`} className="flex-1">
              <Link
                href={`${basePath}?month=${monthParam(point.month)}`}
                title={`${label}: ${amount}`}
                aria-current={point.isSelected ? "true" : undefined}
                className="group flex flex-col items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="sr-only">
                  {label}: {amount}
                </span>

                <span className="relative block h-32 w-full sm:h-40">
                  <span
                    aria-hidden
                    className={cn(
                      // Square at the baseline, rounded at the data end.
                      "absolute inset-x-0 bottom-0 mx-auto block w-full max-w-6 rounded-t-[4px] transition-colors",
                      point.isSelected
                        ? "bg-primary"
                        : "bg-primary/35 group-hover:bg-primary/60",
                    )}
                    style={{ height: `${height}%` }}
                  />

                  {labelled ? (
                    <span
                      aria-hidden
                      className="tabular absolute inset-x-0 text-center text-[11px] font-medium text-muted-foreground"
                      style={{ bottom: `calc(${height}% + 0.25rem)` }}
                    >
                      {formatCompactMinorUnits(point.total, currencyCode)}
                    </span>
                  ) : null}
                </span>

                <span
                  aria-hidden
                  className={cn(
                    "text-xs whitespace-nowrap",
                    point.isSelected
                      ? "font-medium text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {formatMonthShort(point.month, withYear)}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>

      <figcaption className="text-xs text-muted-foreground">
        Spending per month. Choose a column to open that month.
      </figcaption>
    </figure>
  );
}
