"use client";

import { Plus } from "lucide-react";
import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";

import type { CategoryFormAction } from "@/components/categories/category-row";
import { Button } from "@/components/ui/button";
import { Field, fieldAria } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { idleFormState } from "@/lib/auth/form-state";

/**
 * Adding a category of your own (specification section 13).
 *
 * Clears itself on success so several can be added in a row, which is how
 * setting a group up actually goes.
 */
export function AddCategoryForm({
  action,
  hint,
}: {
  action: CategoryFormAction;
  hint: string;
}) {
  const [state, formAction, pending] = useActionState(action, idleFormState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      toast.success(state.message ?? "Category added.", { id: "category-add" });
      formRef.current?.reset();
    }

    if (state.status === "error" && state.message && !state.fieldErrors) {
      toast.error(state.message, { id: "category-add" });
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      <Field
        name="name"
        label="New category"
        hint={hint}
        errors={state.fieldErrors?.name}
      >
        <div className="flex items-center gap-2">
          <Input
            name="name"
            placeholder="Weekend trips"
            maxLength={60}
            autoComplete="off"
            defaultValue={state.values?.name}
            {...fieldAria("name", {
              hasHint: true,
              errors: state.fieldErrors?.name,
            })}
            required
          />
          <Button type="submit" loading={pending}>
            <Plus aria-hidden />
            Add
          </Button>
        </div>
      </Field>
    </form>
  );
}
