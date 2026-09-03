import type { Metadata } from "next";
import { Lock, Trash2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ExpenseForm } from "@/components/expenses/expense-form";
import { GroupContext } from "@/components/groups/group-context";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { EmptyState } from "@/components/ui/empty-state";
import { FadeIn } from "@/components/ui/fade-in";
import { requireProfile } from "@/lib/auth/dal";
import { formatTimestamp, todayIso } from "@/lib/dates";
import {
  deleteGroupExpense,
  updateGroupExpense,
} from "@/lib/expenses/group-actions";
import {
  getGroupExpense,
  listGroupCategories,
} from "@/lib/expenses/group-queries";
import { getGroupDetail } from "@/lib/groups/queries";

export const metadata: Metadata = {
  title: "Edit group expense",
};

export default async function EditGroupExpensePage(
  props: PageProps<"/groups/[id]/expenses/[expenseId]/edit">,
) {
  const { id, expenseId } = await props.params;
  const profile = await requireProfile();

  const detail = await getGroupDetail(id);

  if (!detail) {
    notFound();
  }

  const { group, role, isAdmin, members } = detail;
  const expense = await getGroupExpense(group.id, expenseId, isAdmin);

  if (!expense) {
    notFound();
  }

  const expensesPath = `/groups/${group.id}/expenses`;

  const context = (
    <GroupContext
      groupId={group.id}
      name={group.name}
      description={null}
      currencyCode={group.currency_code}
      role={role}
      backHref={expensesPath}
      backLabel="Back to group expenses"
    />
  );

  // Visible to every member, editable only by whoever recorded it or an admin
  // (specification section 9). The database refuses the write regardless; this
  // says so before the form is filled in rather than after.
  if (!expense.canEdit) {
    return (
      <FadeIn className="mx-auto flex w-full max-w-xl flex-col gap-6">
        {context}

        <Card>
          <EmptyState
            icon={Lock}
            title="You can't edit this expense"
            description={`"${expense.item_name}" was recorded by another member. Only they, or a group admin, can change or delete it.`}
            action={
              <Link href={expensesPath} className={buttonVariants()}>
                Back to expenses
              </Link>
            }
          />
        </Card>
      </FadeIn>
    );
  }

  const categories = await listGroupCategories(group.id);

  return (
    <FadeIn className="mx-auto flex w-full max-w-xl flex-col gap-6">
      {context}

      <Card>
        <CardHeader>
          <CardTitle>Expense details</CardTitle>
          <CardDescription>
            Recorded on {formatTimestamp(expense.created_at)}. Changes are
            visible to everyone in this group.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ExpenseForm
            action={updateGroupExpense.bind(null, group.id, expense.id)}
            categories={categories.filter(
              (category) =>
                !category.is_archived || category.id === expense.category_id,
            )}
            payerName={profile.name}
            members={members.map((member) => ({
              id: member.user_id,
              name: member.profile?.name ?? "Former member",
              isSelf: member.isSelf,
            }))}
            canCreateCategories={isAdmin}
            currencyCode={group.currency_code}
            serverToday={todayIso()}
            defaults={{
              itemName: expense.item_name,
              amount: expense.amount.toFixed(2),
              expenseDate: expense.expense_date,
              category: expense.category_id ?? "",
              paidBy: expense.paid_by,
              paymentMode: expense.payment_mode ?? "",
              notes: expense.notes ?? "",
            }}
            submitLabel="Save changes"
            cancelHref={expensesPath}
          />
        </CardContent>
      </Card>

      <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <p className="text-sm font-medium">Delete this expense</p>
          <p className="text-xs text-muted-foreground">
            It disappears from the group&rsquo;s records. This cannot be undone.
          </p>
        </div>

        <ConfirmAction
          action={deleteGroupExpense}
          fields={{ id: expense.id, groupId: group.id }}
          label="Delete"
          ariaLabel={`Delete ${expense.item_name}`}
          icon={<Trash2 aria-hidden />}
          toastId="group-expense-delete"
        />
      </Card>
    </FadeIn>
  );
}
