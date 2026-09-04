"use client";

import { UserPlus } from "lucide-react";
import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { idleFormState } from "@/lib/auth/form-state";
import { acceptInvitationByToken } from "@/lib/groups/actions";

/**
 * Joins the group an invitation *link* points at.
 *
 * The in-app inbox at `/invitations` is the ordinary way in; this exists for
 * someone who had no account when they were invited, and so had no inbox for it
 * to appear in.
 *
 * The token is the only thing submitted. Which group it grants, and in what
 * role, is read from the invitation server-side and enforced again by the
 * insert policy — a modified form can only fail.
 */
export function AcceptInvitationForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(
    acceptInvitationByToken,
    idleFormState,
  );

  useEffect(() => {
    if (state.status === "error" && state.message) {
      toast.error(state.message, { id: "invitation-accept" });
    }
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />

      {state.status === "error" && state.message ? (
        <p
          role="alert"
          className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger-strong"
        >
          {state.message}
        </p>
      ) : null}

      <Button type="submit" loading={pending} size="lg">
        <UserPlus aria-hidden />
        Join group
      </Button>
    </form>
  );
}
