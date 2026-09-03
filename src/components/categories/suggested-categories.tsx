"use client";

import { Plus } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import type { CategoryFormAction } from "@/components/categories/category-row";
import { Button } from "@/components/ui/button";
import { idleFormState } from "@/lib/auth/form-state";
import { cn } from "@/lib/utils";

/**
 * The suggested default categories that have not been taken yet
 * (specification section 13: defaults are offered, never forced).
 *
 * Each chip is a real checkbox with a visible focus ring, so the whole set is
 * reachable with Tab and Space, and the form submits every checked name in one
 * request rather than one per category.
 */
export function SuggestedCategories({
  action,
  suggestions,
}: {
  action: CategoryFormAction;
  suggestions: readonly string[];
}) {
  const [state, formAction, pending] = useActionState(action, idleFormState);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (state.status === "success") {
      toast.success(state.message ?? "Categories added.", { id: "category-defaults" });
    }

    if (state.status === "error" && state.message) {
      toast.error(state.message, { id: "category-defaults" });
    }
  }, [state]);

  if (suggestions.length === 0) {
    return null;
  }

  // The selection is derived rather than cleared: a name that was added is no
  // longer suggested, so it drops out of `active` on the next render without
  // an effect having to reach back in and reset state.
  const active = selected.filter((name) => suggestions.includes(name));

  const toggle = (name: string) => {
    setSelected((current) =>
      current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name],
    );
  };

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Suggested categories</legend>
        <p className="text-xs text-muted-foreground">
          Pick the ones you want. You can rename or remove them later.
        </p>

        <div className="mt-1 flex flex-wrap gap-2">
          {suggestions.map((name) => {
            const checked = active.includes(name);

            return (
              <label
                key={name}
                className={cn(
                  "cursor-pointer rounded-full border px-3 py-1.5 text-sm transition-colors",
                  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background",
                  checked
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-foreground hover:bg-muted",
                )}
              >
                <input
                  type="checkbox"
                  name="names"
                  value={name}
                  checked={checked}
                  onChange={() => toggle(name)}
                  className="sr-only"
                />
                {name}
              </label>
            );
          })}
        </div>
      </fieldset>

      <Button
        type="submit"
        variant="secondary"
        size="sm"
        className="w-fit"
        loading={pending}
        disabled={active.length === 0}
      >
        <Plus aria-hidden />
        {active.length === 0
          ? "Add selected"
          : `Add ${active.length} ${active.length === 1 ? "category" : "categories"}`}
      </Button>
    </form>
  );
}
