"use client";

import type { ReactNode } from "react";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button, type ButtonProps } from "@/components/ui/button";
import { idleFormState, type FormState } from "@/lib/auth/form-state";

type ConfirmActionProps = {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  /** Hidden inputs the action needs — an id, a group id. */
  fields: Record<string, string>;
  label: string;
  /** Shown once the user has asked for it. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Spoken label, when the visible one is not specific enough on its own. */
  ariaLabel?: string;
  /**
   * Passed as an element, not a component: this is a Client Component, and a
   * function cannot cross that boundary from a Server Component. An element
   * can.
   */
  icon?: ReactNode;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  /** Stable toast id, so repeated failures replace rather than stack. */
  toastId: string;
  /** Hides the label below `sm`, leaving the icon. */
  compact?: boolean;
};

/**
 * A destructive action behind an inline confirmation.
 *
 * The first button is a real submit button, so with JavaScript disabled it
 * posts straight to the action and the thing happens. With JavaScript it
 * becomes a confirmation step instead — a mis-click is recoverable without a
 * modal dialog, and nothing depends on client code to be safe.
 *
 * A failure leaves the confirmation open, so the retry is one click and the
 * message has something to sit next to.
 */
export function ConfirmAction({
  action,
  fields,
  label,
  confirmLabel = "Confirm",
  ariaLabel,
  icon,
  variant = "ghost",
  size = "sm",
  toastId,
  compact = false,
}: ConfirmActionProps) {
  const [state, formAction, pending] = useActionState(action, idleFormState);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (state.status === "error" && state.message) {
      toast.error(state.message, { id: toastId });
    }

    if (state.status === "success" && state.message) {
      toast.success(state.message, { id: toastId });
    }
  }, [state, toastId]);

  return (
    <form action={formAction} className="flex items-center gap-1">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      {confirming ? (
        <>
          <Button type="submit" variant="danger" size={size} loading={pending}>
            {confirmLabel}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size={size}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </Button>
        </>
      ) : (
        <Button
          type="submit"
          variant={variant}
          size={size}
          aria-label={ariaLabel}
          onClick={(event) => {
            // Progressive enhancement: with JavaScript, ask first.
            event.preventDefault();
            setConfirming(true);
          }}
        >
          {icon}
          <span className={compact ? "sr-only sm:not-sr-only" : undefined}>
            {label}
          </span>
        </Button>
      )}
    </form>
  );
}
