"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { Field, fieldAria } from "@/components/ui/field";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { idleFormState, type FormState } from "@/lib/auth/form-state";
import { CURRENCIES, DEFAULT_CURRENCY_CODE } from "@/lib/constants";
import type { CurrencyCode } from "@/types";

export type GroupFormDefaults = {
  name?: string;
  description?: string;
  currencyCode?: CurrencyCode;
};

type GroupFormProps = {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  defaults?: GroupFormDefaults;
  /**
   * Set once the group has expenses. The currency then belongs to the amounts
   * already recorded, and the database refuses to change it.
   */
  currencyLocked?: boolean;
  submitLabel: string;
  cancelHref: string;
};

/**
 * Create and edit a group (specification sections 8 and 10).
 *
 * The currency is part of creating a group rather than an afterthought,
 * because every amount recorded in the group is denominated in it. Native
 * controls throughout, matching the expense form.
 */
export function GroupForm({
  action,
  defaults,
  currencyLocked = false,
  submitLabel,
  cancelHref,
}: GroupFormProps) {
  const [state, formAction, pending] = useActionState(action, idleFormState);

  useEffect(() => {
    if (state.status === "error" && state.message) {
      toast.error(state.message, { id: "group-form" });
    }
  }, [state]);

  const currencyCode =
    state.values?.currencyCode ??
    defaults?.currencyCode ??
    DEFAULT_CURRENCY_CODE;

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <FormField
        label="Group name"
        name="name"
        placeholder="Goa Trip 2026"
        defaultValue={state.values?.name ?? defaults?.name}
        errors={state.fieldErrors?.name}
        maxLength={80}
        autoComplete="off"
        required
      />

      <Field
        name="description"
        label="Description"
        errors={state.fieldErrors?.description}
        hint="Optional. A line to remind everyone what this group is for."
      >
        <Textarea
          name="description"
          placeholder="Shared costs for the September trip."
          maxLength={500}
          defaultValue={state.values?.description ?? defaults?.description}
          {...fieldAria("description", {
            hasHint: true,
            errors: state.fieldErrors?.description,
          })}
        />
      </Field>

      <Field
        name="currencyCode"
        label="Currency"
        errors={state.fieldErrors?.currencyCode}
        hint={
          currencyLocked
            ? "Locked: this group already has expenses recorded in this currency."
            : "Every expense in this group is recorded in this currency. It can be changed until the first expense is added."
        }
      >
        <Select
          name="currencyCode"
          defaultValue={currencyCode}
          disabled={currencyLocked}
          {...fieldAria("currencyCode", {
            hasHint: true,
            errors: state.fieldErrors?.currencyCode,
          })}
        >
          {CURRENCIES.map((currency) => (
            <option key={currency.code} value={currency.code}>
              {currency.symbol} {currency.label} ({currency.code})
            </option>
          ))}
        </Select>
        {/* A disabled select submits nothing, so the current value still has
            to reach the server for the update to be complete. */}
        {currencyLocked ? (
          <input type="hidden" name="currencyCode" value={currencyCode} />
        ) : null}
      </Field>

      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" loading={pending}>
          {submitLabel}
        </Button>
        <Link
          href={cancelHref}
          className={buttonVariants({ variant: "ghost", size: "md" })}
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
