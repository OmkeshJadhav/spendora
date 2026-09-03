"use client";

import { Trash2 } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { idleFormState } from "@/lib/auth/form-state";
import { deleteExpense } from "@/lib/expenses/actions";

/**
 * Deletes an expense behind an inline confirmation.
 *
 * The first button is a real submit button: without JavaScript it posts
 * straight to the action and the expense is deleted. With JavaScript it turns
 * into a confirmation step instead, so a mis-click is recoverable without a
 * modal dialog. The success message arrives as a flash on the page it
 * redirects to, because this component is gone by then.
 */
export function DeleteExpenseButton({
  id,
  itemName,
}: {
  id: string;
  itemName: string;
}) {
  const [state, formAction, pending] = useActionState(
    deleteExpense,
    idleFormState,
  );
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (state.status === "error" && state.message) {
      toast.error(state.message, { id: "expense-delete" });
    }
  }, [state]);

  return (
    <form action={formAction} className="flex items-center gap-1">
      <input type="hidden" name="id" value={id} />

      {confirming ? (
        <>
          <Button type="submit" variant="danger" size="sm" loading={pending}>
            Confirm
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConfirming(false)}
          >
            Cancel
          </Button>
        </>
      ) : (
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          aria-label={`Delete ${itemName}`}
          onClick={(event) => {
            // Progressive enhancement: with JavaScript, ask first.
            event.preventDefault();
            setConfirming(true);
          }}
        >
          <Trash2 aria-hidden />
          <span className="sr-only sm:not-sr-only">Delete</span>
        </Button>
      )}
    </form>
  );
}
