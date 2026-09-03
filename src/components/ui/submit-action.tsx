"use client";

import type { ReactNode } from "react";
import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { Button, type ButtonProps } from "@/components/ui/button";
import { idleFormState, type FormState } from "@/lib/auth/form-state";

type SubmitActionProps = {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  /** Hidden inputs the action needs — an id, a group id. */
  fields: Record<string, string>;
  label: string;
  /** Spoken label, when the visible one is not specific enough on its own. */
  ariaLabel?: string;
  /** An element, not a component: a function cannot cross this boundary. */
  icon?: ReactNode;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  /** Stable toast id, so repeated failures replace rather than stack. */
  toastId: string;
};

/**
 * A one-click action posted from a plain form, so it works without JavaScript.
 *
 * The counterpart to `ConfirmAction`: same shape, no confirmation step, for
 * things that are not destructive. Success normally arrives as a flash on the
 * page the action redirects to, so only failures are toasted here.
 */
export function SubmitAction({
  action,
  fields,
  label,
  ariaLabel,
  icon,
  variant = "primary",
  size = "sm",
  toastId,
}: SubmitActionProps) {
  const [state, formAction, pending] = useActionState(action, idleFormState);

  useEffect(() => {
    if (state.status === "error" && state.message) {
      toast.error(state.message, { id: toastId });
    }

    if (state.status === "success" && state.message) {
      toast.success(state.message, { id: toastId });
    }
  }, [state, toastId]);

  return (
    <form action={formAction}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <Button
        type="submit"
        variant={variant}
        size={size}
        aria-label={ariaLabel}
        loading={pending}
      >
        {pending ? null : icon}
        {label}
      </Button>
    </form>
  );
}
