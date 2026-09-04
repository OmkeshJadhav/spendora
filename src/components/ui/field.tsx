import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";

/**
 * The shell every form control shares: a label bound to the control, optional
 * hint text, and an error that is announced when it appears. Controls differ
 * (input, select, textarea); this wiring should not.
 */

type FieldAria = {
  id: string;
  "aria-invalid": true | undefined;
  "aria-describedby": string | undefined;
};

/**
 * Accessibility props the control must spread, matching `Field`'s markup.
 *
 * `hasHint` must agree with whether a `hint` was given to `Field`, otherwise
 * `aria-describedby` would point at an element that is not rendered.
 */
export function fieldAria(
  name: string,
  { hasHint, errors }: { hasHint?: boolean; errors?: string[] } = {},
): FieldAria {
  const hasError = Boolean(errors?.length);
  const describedBy = [
    hasHint ? `${name}-hint` : null,
    hasError ? `${name}-error` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    id: name,
    "aria-invalid": hasError || undefined,
    "aria-describedby": describedBy || undefined,
  };
}

type FieldProps = {
  name: string;
  label: string;
  /** Server-side validation messages for this field. */
  errors?: string[];
  hint?: string;
  children: ReactNode;
  className?: string;
};

function Field({ name, label, errors, hint, children, className }: FieldProps) {
  const hasError = Boolean(errors?.length);

  return (
    <div className={className ?? "flex flex-col gap-1.5"}>
      <Label htmlFor={name}>{label}</Label>
      {children}
      {hint ? (
        <p id={`${name}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {hasError ? (
        <p
          id={`${name}-error`}
          role="alert"
          className="text-xs font-medium text-danger-strong"
        >
          {errors?.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

export { Field };
