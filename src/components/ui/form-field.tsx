import type { ComponentProps } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FormFieldProps = ComponentProps<"input"> & {
  label: string;
  name: string;
  /** Server-side validation messages for this field. */
  errors?: string[];
  hint?: string;
};

/**
 * A labelled input wired up for accessibility: the label points at the input,
 * errors are announced, and `aria-describedby` links help text and errors.
 */
function FormField({
  label,
  name,
  errors,
  hint,
  id,
  ...inputProps
}: FormFieldProps) {
  const fieldId = id ?? name;
  const errorId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;
  const hasError = Boolean(errors?.length);

  const describedBy = [hint ? hintId : null, hasError ? errorId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={fieldId}>{label}</Label>
      <Input
        id={fieldId}
        name={name}
        aria-invalid={hasError || undefined}
        aria-describedby={describedBy || undefined}
        {...inputProps}
      />
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {hasError ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger">
          {errors?.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

export { FormField };
