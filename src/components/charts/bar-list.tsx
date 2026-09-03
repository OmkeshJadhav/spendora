import { formatMinorUnits } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { CurrencyCode } from "@/types";

/**
 * A ranked horizontal bar chart (specification section 38).
 *
 * Used for category spending and for member spending, which are the same
 * question — compare magnitudes across a handful of named things — so they are
 * the same chart rather than two.
 *
 * One series, one hue. A categorical palette would be wrong here: the
 * categories are not distinct *series*, they are one measure across several
 * names, and colouring them would bury the point (which is biggest) under
 * decoration. Because there is only one colour there is nothing to look up, so
 * there is no legend either — the title says what is plotted.
 *
 * Nothing depends on seeing the bar. Every row prints its amount and its share
 * as text beside the label, so the bars are marked `aria-hidden` rather than
 * announced twice, and each carries a `title` so hovering one gives the exact
 * figure.
 */

export type BarItem = {
  /** Stable key for React, and what a test can find the row by. */
  key: string;
  label: string;
  /** Minor units. */
  value: number;
  /** Whole-number share of the total, printed beside the amount. */
  share: number;
  /** Supporting line under the label, e.g. "4 expenses". */
  hint?: string;
  /**
   * Draws this row in the full accent hue and the rest in a lighter step of
   * the same ramp — the emphasis pattern, used for the signed-in user's own
   * row. Never the only signal: an emphasised row is also labelled.
   */
  emphasis?: boolean;
};

export function BarList({
  items,
  currencyCode,
  className,
}: {
  items: BarItem[];
  currencyCode: CurrencyCode;
  className?: string;
}) {
  // Bars are scaled against the largest value, not against the total, so the
  // chart uses its width to compare magnitudes. The share of the total is the
  // number printed beside each one.
  const max = items.reduce((largest, item) => Math.max(largest, item.value), 0);
  const anyEmphasis = items.some((item) => item.emphasis);

  return (
    <ul className={cn("flex flex-col gap-4", className)}>
      {items.map((item) => {
        const amount = formatMinorUnits(item.value, currencyCode);
        // A zero-value row still shows a sliver, so it reads as a bar at zero
        // rather than as a row whose chart failed to render.
        const width = max > 0 ? Math.max((item.value / max) * 100, 1.5) : 1.5;

        return (
          <li key={item.key}>
            <div className="flex items-baseline justify-between gap-4">
              <span className="truncate text-sm font-medium">{item.label}</span>
              <span className="shrink-0 text-sm">
                <span className="tabular font-medium">{amount}</span>
                <span className="tabular ml-2 text-xs text-muted-foreground">
                  {item.share}%
                </span>
              </span>
            </div>

            <div
              className="mt-1.5 h-2 w-full overflow-hidden rounded-[4px] bg-muted"
              aria-hidden
              title={`${item.label}: ${amount} (${item.share}%)`}
            >
              <div
                className={cn(
                  // Square where it meets the baseline, rounded at the data
                  // end — the end of the bar is the thing being read.
                  "h-full rounded-r-[4px]",
                  anyEmphasis && !item.emphasis ? "bg-primary/35" : "bg-primary",
                )}
                style={{ width: `${width}%` }}
              />
            </div>

            {item.hint ? (
              <p className="mt-1 text-xs text-muted-foreground">{item.hint}</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
