import { Badge } from "@/components/ui/badge";
import type { BudgetProgress, BudgetState } from "@/lib/budgets/status";
import { formatMinorUnits } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { CurrencyCode } from "@/types";

/**
 * One budget's progress (specification section 16).
 *
 * Colour is never the only signal: every meter also states its status in
 * words, spells the figures out beside it, and carries an `aria-valuetext`
 * that reads as a sentence — so the bar is a convenience for people who can
 * see it and nothing depends on doing so.
 */

const BAR_COLOURS: Record<BudgetState, string> = {
  none: "bg-muted-foreground/40",
  healthy: "bg-success",
  warning: "bg-warning",
  exceeded: "bg-danger",
};

const BADGE_VARIANTS: Record<
  BudgetState,
  "neutral" | "success" | "warning" | "danger"
> = {
  none: "neutral",
  healthy: "success",
  warning: "warning",
  exceeded: "danger",
};

export function BudgetStatusBadge({ progress }: { progress: BudgetProgress }) {
  return (
    <Badge variant={BADGE_VARIANTS[progress.state]}>{progress.label}</Badge>
  );
}

export function BudgetMeter({
  progress,
  currencyCode,
  label,
  className,
}: {
  progress: BudgetProgress;
  currencyCode: CurrencyCode;
  /** What the bar is measuring, for screen readers: a category, or the month. */
  label: string;
  className?: string;
}) {
  if (progress.budget === null) {
    return null;
  }

  const spent = formatMinorUnits(progress.spent, currencyCode);
  const budget = formatMinorUnits(progress.budget, currencyCode);

  return (
    <div
      className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      // Clamped, because a bar cannot be more than full. The overspend is in
      // the text below it, and in `aria-valuetext` here.
      aria-valuenow={progress.barWidth}
      aria-valuetext={`${label}: ${spent} of ${budget}, ${progress.used}% used. ${progress.label}.`}
    >
      <div
        className={cn("h-full rounded-full transition-all", BAR_COLOURS[progress.state])}
        // A little width even at 0%, so the bar reads as a track with a
        // starting point rather than as an empty box.
        style={{ width: `${Math.max(progress.barWidth, 2)}%` }}
      />
    </div>
  );
}

/** "₹6,200 of ₹8,000 · 78% used · ₹1,800 left" — the figures in section 15. */
export function BudgetFigures({
  progress,
  currencyCode,
}: {
  progress: BudgetProgress;
  currencyCode: CurrencyCode;
}) {
  if (progress.budget === null) {
    return (
      <p className="text-sm text-muted-foreground">
        <span className="tabular font-medium text-foreground">
          {formatMinorUnits(progress.spent, currencyCode)}
        </span>{" "}
        spent · no budget set
      </p>
    );
  }

  const over = progress.remaining !== null && progress.remaining < 0;

  return (
    <p className="text-sm text-muted-foreground">
      <span className="tabular font-medium text-foreground">
        {formatMinorUnits(progress.spent, currencyCode)}
      </span>{" "}
      of <span className="tabular">{formatMinorUnits(progress.budget, currencyCode)}</span>
      <span aria-hidden> · </span>
      <span className="tabular">{progress.used}% used</span>
      <span aria-hidden> · </span>
      <span className={cn("tabular", over && "font-medium text-danger-strong")}>
        {formatMinorUnits(Math.abs(progress.remaining ?? 0), currencyCode)}{" "}
        {over ? "over" : "left"}
      </span>
    </p>
  );
}
