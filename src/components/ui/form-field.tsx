import type { ComponentProps } from "react";

import { Field, fieldAria } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type FormFieldProps = Omit<ComponentProps<"input">, "id"> & {
  label: string;
  name: string;
  /** Server-side validation messages for this field. */
  errors?: string[];
  hint?: string;
};

/**
 * A labelled text input: the label points at the input, errors are announced,
 * and `aria-describedby` links help text and errors.
 */
function FormField({ label, name, errors, hint, ...inputProps }: FormFieldProps) {
  return (
    <Field name={name} label={label} errors={errors} hint={hint}>
      <Input name={name} {...fieldAria(name, { hasHint: Boolean(hint), errors })} {...inputProps} />
    </Field>
  );
}

export { FormField };
