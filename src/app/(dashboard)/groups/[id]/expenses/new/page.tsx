import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { GroupExpenseEntry } from "@/components/expenses/expense-entry";
import { GroupContext } from "@/components/groups/group-context";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FadeIn } from "@/components/ui/fade-in";
import { getGroupDetail } from "@/lib/groups/queries";

export const metadata: Metadata = {
  title: "Add group expense",
};

export default async function NewGroupExpensePage(
  props: PageProps<"/groups/[id]/expenses/new">,
) {
  const { id } = await props.params;
  const detail = await getGroupDetail(id);

  if (!detail) {
    notFound();
  }

  const { group, role } = detail;

  return (
    <FadeIn className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <GroupContext
        groupId={group.id}
        name={group.name}
        description={null}
        currencyCode={group.currency_code}
        role={role}
        backHref={`/groups/${group.id}/expenses`}
        backLabel="Back to group expenses"
      />

      <Card>
        <CardHeader>
          <CardTitle>Expense details</CardTitle>
          <CardDescription>
            Everyone in this group can see this expense. Amounts are recorded in
            the group&rsquo;s currency.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GroupExpenseEntry groupId={group.id} />
        </CardContent>
      </Card>
    </FadeIn>
  );
}
