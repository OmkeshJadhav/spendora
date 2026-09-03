import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ExpenseForm } from "@/components/expenses/expense-form";
import { GroupContext } from "@/components/groups/group-context";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FadeIn } from "@/components/ui/fade-in";
import { requireProfile, requireUser } from "@/lib/auth/dal";
import { todayIso } from "@/lib/dates";
import { createGroupExpense } from "@/lib/expenses/group-actions";
import { listGroupCategories } from "@/lib/expenses/group-queries";
import { getGroupDetail } from "@/lib/groups/queries";

export const metadata: Metadata = {
  title: "Add group expense",
};

export default async function NewGroupExpensePage(
  props: PageProps<"/groups/[id]/expenses/new">,
) {
  const { id } = await props.params;
  const user = await requireUser();
  const profile = await requireProfile();

  const detail = await getGroupDetail(id);

  if (!detail) {
    notFound();
  }

  const { group, role, isAdmin, members } = detail;
  const categories = await listGroupCategories(group.id);

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
          {/* Bound here, in the Server Component that renders the form: a
              Server Action bound inside a Client Component never returns. */}
          <ExpenseForm
            action={createGroupExpense.bind(null, group.id)}
            categories={categories.filter((category) => !category.is_archived)}
            payerName={profile.name}
            members={members.map((member) => ({
              id: member.user_id,
              name: member.profile?.name ?? "Former member",
              isSelf: member.isSelf,
            }))}
            canCreateCategories={isAdmin}
            currencyCode={group.currency_code}
            serverToday={todayIso()}
            defaults={{ paidBy: user.id }}
            submitLabel="Save expense"
            cancelHref={`/groups/${group.id}/expenses`}
          />
        </CardContent>
      </Card>
    </FadeIn>
  );
}
