/** Shape returned by auth-related Server Actions to `useActionState`. */
export type FormState = {
  status: "idle" | "error" | "success";
  /** User-facing message. Never a raw provider or database error. */
  message?: string;
  /** Per-field validation messages, keyed by input name. */
  fieldErrors?: Record<string, string[]>;
  /** Values echoed back so the form can repopulate; never includes passwords. */
  values?: Record<string, string>;
};

export const idleFormState: FormState = { status: "idle" };
