"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { updateProfileName } from "@/lib/auth/actions";
import { idleFormState } from "@/lib/auth/form-state";

export function ProfileForm({ name }: { name: string }) {
  const [state, formAction, pending] = useActionState(
    updateProfileName,
    idleFormState,
  );

  useEffect(() => {
    if (state.status === "error" && state.message) {
      toast.error(state.message, { id: "profile" });
    }

    if (state.status === "success" && state.message) {
      toast.success(state.message, { id: "profile" });
    }
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormField
        label="Display name"
        name="name"
        autoComplete="name"
        defaultValue={state.values?.name ?? name}
        errors={state.fieldErrors?.name}
        hint="Used wherever your name appears, such as “Paid by”."
        maxLength={80}
        required
      />

      <div>
        <Button type="submit" loading={pending}>
          Save changes
        </Button>
      </div>
    </form>
  );
}
