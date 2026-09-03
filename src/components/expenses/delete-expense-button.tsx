import { Trash2 } from "lucide-react";

import { ConfirmAction } from "@/components/ui/confirm-action";
import { deleteExpense } from "@/lib/expenses/actions";

/**
 * Deletes an expense behind an inline confirmation. The success message
 * arrives as a flash on the page it redirects to, because this component is
 * gone by then.
 */
export function DeleteExpenseButton({
  id,
  itemName,
}: {
  id: string;
  itemName: string;
}) {
  return (
    <ConfirmAction
      action={deleteExpense}
      fields={{ id }}
      label="Delete"
      ariaLabel={`Delete ${itemName}`}
      icon={<Trash2 aria-hidden />}
      toastId="expense-delete"
      compact
    />
  );
}
