import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import {
  compareMonths,
  currentMonthKey,
  formatMonthLabel,
  maxMonth,
  MIN_MONTH,
  monthParam,
  shiftMonth,
} from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { MonthKey } from "@/types";

/**
 * `‹ September 2026 ›` (specification section 58).
 *
 * Plain links, not buttons: the month lives in the URL, so a month view is
 * shareable and bookmarkable, the back button steps through months, and none
 * of it needs client-side JavaScript. Next re-renders only the Server
 * Component tree that changed, which is the "smooth interaction" section 23
 * asks for without a client-side store.
 */
export function MonthNav({
  month,
  /** Page this navigates within, e.g. `/categories`. */
  basePath,
  /** Extra query parameters to carry across a month change. */
  params,
  className,
}: {
  month: MonthKey;
  basePath: string;
  params?: Record<string, string>;
  className?: string;
}) {
  const href = (target: MonthKey) => {
    const query = new URLSearchParams({ ...params, month: monthParam(target) });

    return `${basePath}?${query.toString()}`;
  };

  const previous = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);

  // The same window an expense may be dated in, so the arrows never lead to a
  // month that cannot hold anything.
  const canGoBack = compareMonths(previous, MIN_MONTH) >= 0;
  const canGoForward = compareMonths(next, maxMonth()) <= 0;
  const isCurrent = compareMonths(month, currentMonthKey()) === 0;

  const arrow = cn(buttonVariants({ variant: "secondary", size: "icon" }), "size-9");

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {canGoBack ? (
        <Link href={href(previous)} className={arrow} aria-label={`Previous month, ${formatMonthLabel(previous)}`}>
          <ChevronLeft aria-hidden />
        </Link>
      ) : (
        <span className={cn(arrow, "pointer-events-none opacity-40")} aria-hidden>
          <ChevronLeft />
        </span>
      )}

      <p
        className="min-w-40 text-center text-sm font-medium"
        // Announced when it changes, so a keyboard user hears which month they
        // have moved to without hunting for it.
        aria-live="polite"
      >
        {formatMonthLabel(month)}
      </p>

      {canGoForward ? (
        <Link href={href(next)} className={arrow} aria-label={`Next month, ${formatMonthLabel(next)}`}>
          <ChevronRight aria-hidden />
        </Link>
      ) : (
        <span className={cn(arrow, "pointer-events-none opacity-40")} aria-hidden>
          <ChevronRight />
        </span>
      )}

      {isCurrent ? null : (
        <Link
          href={href(currentMonthKey())}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          This month
        </Link>
      )}
    </div>
  );
}
