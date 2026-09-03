"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { idleFormState, type FormState } from "@/lib/auth/form-state";
import type { GroupRole } from "@/types";

/**
 * Changes one member's role (specification section 9).
 *
 * The Save button is a plain submit button rather than something that fires on
 * change: a role change is a permission change, and it should take a
 * deliberate second action. It also means the control behaves identically
 * with and without JavaScript.
 *
 * The action arrives already bound to its group — see `InviteForm` for why
 * binding never happens on this side of the boundary.
 */
export function MemberRoleForm({
  action,
  memberId,
  memberName,
  role,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  memberId: string;
  memberName: string;
  role: GroupRole;
}) {
  const [state, formAction, pending] = useActionState(action, idleFormState);
  const [selected, setSelected] = useState<GroupRole>(role);

  useEffect(() => {
    if (state.status === "error" && state.message) {
      toast.error(state.message, { id: `member-role-${memberId}` });
    }

    if (state.status === "success" && state.message) {
      toast.success(state.message, { id: `member-role-${memberId}` });
    }
  }, [state, memberId]);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="memberId" value={memberId} />

      <label className="sr-only" htmlFor={`role-${memberId}`}>
        Role for {memberName}
      </label>
      <Select
        id={`role-${memberId}`}
        name="role"
        value={selected}
        onChange={(event) => setSelected(event.target.value as GroupRole)}
        className="h-8 w-28 text-xs"
      >
        <option value="member">Member</option>
        <option value="admin">Admin</option>
      </Select>

      <Button
        type="submit"
        variant="secondary"
        size="sm"
        loading={pending}
        // Nothing to save until the selection actually differs.
        disabled={selected === role}
      >
        Save
      </Button>
    </form>
  );
}
