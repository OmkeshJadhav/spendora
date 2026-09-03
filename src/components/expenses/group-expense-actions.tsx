import { Pencil, Trash2 } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { deleteGroupExpense } from "@/lib/expenses/group-actions";

/**
 * Edit and delete for one group expense.
 *
 * Rendered only when the viewer may actually use them — the member who
 * recorded the expense, or an admin of the group (specification section 9).
 * Hiding them is a courtesy, not the control: RLS refuses the write either
 * way, which is what the "you don't have permission" message reports.
 */
export function GroupExpenseActions({
  groupId,
  expenseId,
  itemName,
  canEdit,
}: {
  groupId: string;
  expenseId: string;
  itemName: string;
  canEdit: boolean;
}) {
  if (!canEdit) {
    return (
      <span className="px-2 text-xs text-muted-foreground">
        Recorded by another member
      </span>
    );
  }

  return (
    <>
      <Link
        href={`/groups/${groupId}/expenses/${expenseId}/edit`}
        aria-label={`Edit ${itemName}`}
        className={buttonVariants({ variant: "ghost", size: "sm" })}
      >
        <Pencil aria-hidden />
        <span className="sr-only sm:not-sr-only">Edit</span>
      </Link>

      <ConfirmAction
        action={deleteGroupExpense}
        fields={{ id: expenseId, groupId }}
        label="Delete"
        ariaLabel={`Delete ${itemName}`}
        icon={<Trash2 aria-hidden />}
        toastId="group-expense-delete"
        compact
      />
    </>
  );
}
