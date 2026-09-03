import { PiggyBank, ReceiptText, TrendingUp, Wallet } from "lucide-react";

import { BudgetFigures, BudgetMeter } from "@/components/budgets/budget-meter";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card } from "@/components/ui/card";
import type { BudgetOverview } from "@/lib/budgets/queries";
import { budgetProgress } from "@/lib/budgets/status";
import { formatMonthLabel } from "@/lib/dates";
import { formatMinorUnits } from "@/lib/money";
import type { CurrencyCode } from "@/types";

/**
 * The monthly summary both dashboards lead with (specification sections 17
 * and 18).
 *
 * One component for the personal and the group dashboard, because they ask for
 * the same figures: what was spent, over how many expenses, at what daily
 * rate, and how much of the budget is left. The month's overall budget is
 * spelled out in the meter below the cards rather than taking a fifth card —
 * "₹37,500 of ₹50,000 · 75% used · ₹12,500 left" says all three of section
 * 18's figures in one line, and states them in words as well as in a bar.
 */
export function MonthSummary({
  overview,
  averageDaily,
  currencyCode,
}: {
  overview: BudgetOverview;
  /** Minor units per day elapsed this month. */
  averageDaily: number;
  currencyCode: CurrencyCode;
}) {
  const { totals, month, expenseCount } = overview;
  const monthLabel = formatMonthLabel(month);

  // `totals.remaining` is `budget - spent`, so it is negative whenever anything
  // was spent and no budget exists. Without `hasBudget` the card would title
  // itself "Over budget" for somebody who has never set one, which is not what
  // being over a budget means.
  const overspent = totals.hasBudget && totals.remaining < 0;

  // The month as a whole, expressed exactly as a single category is, so the
  // summary bar and the category bars mean the same thing.
  const progress = budgetProgress(
    totals.spent,
    totals.hasBudget ? totals.budget : null,
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Spent"
          value={formatMinorUnits(totals.spent, currencyCode)}
          hint={monthLabel}
          icon={Wallet}
        />
        <StatCard
          title="Expenses"
          value={String(expenseCount)}
          hint={expenseCount === 1 ? "record" : "records"}
          icon={ReceiptText}
        />
        <StatCard
          title="Average daily"
          value={formatMinorUnits(averageDaily, currencyCode)}
          hint="Per day so far this month"
          icon={TrendingUp}
        />
        <StatCard
          title={overspent ? "Over budget" : "Remaining"}
          value={
            totals.hasBudget
              ? formatMinorUnits(Math.abs(totals.remaining), currencyCode)
              : "No budget"
          }
          hint={
            totals.hasBudget
              ? `of ${formatMinorUnits(totals.budget, currencyCode)} budgeted`
              : "Set one to track this"
          }
          icon={PiggyBank}
        />
      </div>

      {totals.hasBudget ? (
        <Card className="flex flex-col gap-2 p-5">
          <BudgetFigures progress={progress} currencyCode={currencyCode} />
          <BudgetMeter
            progress={progress}
            currencyCode={currencyCode}
            label={`${monthLabel} overall`}
          />
        </Card>
      ) : null}
    </div>
  );
}
