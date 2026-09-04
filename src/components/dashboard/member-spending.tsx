import { Users } from "lucide-react";

import { BarList, type BarItem } from "@/components/charts/bar-list";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { MemberTotal } from "@/lib/dashboard/summary";
import { formatMonthLabel } from "@/lib/dates";
import type { CurrencyCode, MonthKey } from "@/types";

/**
 * Who paid what (specification section 21).
 *
 * Attribution is by "Paid by", not by who typed the expense in — a member may
 * record that somebody else paid, and it is the payer the group cares about.
 * Every member is listed, including one who has paid nothing this month: a
 * zero is information, and a row that vanished would read as a bug.
 *
 * The signed-in user's row is emphasised and labelled "You", so finding
 * yourself in the list does not depend on remembering your own display name —
 * or on seeing the difference in shade.
 */
export function MemberSpending({
  members,
  currencyCode,
  month,
}: {
  members: MemberTotal[];
  currencyCode: CurrencyCode;
  month: MonthKey;
}) {
  const monthLabel = formatMonthLabel(month);
  const anySpending = members.some((member) => member.total > 0);

  const items: BarItem[] = members.map((member) => ({
    key: member.userId,
    label: member.isSelf ? `${member.name} (You)` : member.name,
    value: member.total,
    share: member.share,
    hint:
      member.count === 0
        ? "Nothing paid this month"
        : `${member.count} ${member.count === 1 ? "expense" : "expenses"}`,
    emphasis: member.isSelf,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users aria-hidden className="size-4 text-muted-foreground" />
          Spending by member
        </CardTitle>
        <CardDescription>
          Who paid for what this group spent in {monthLabel}, and what share of
          it that was.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {anySpending ? (
          <BarList items={items} currencyCode={currencyCode} />
        ) : (
          <EmptyState
            icon={Users}
            title={`Nobody spent anything in ${monthLabel}`}
            description="Once someone records an expense for this month, spending per member appears here."
            className="py-8"
          />
        )}
      </CardContent>
    </Card>
  );
}
