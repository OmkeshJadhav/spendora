"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { Field, fieldAria } from "@/components/ui/field";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { idleFormState, type FormState } from "@/lib/auth/form-state";
import { DEFAULT_CATEGORIES, PAYMENT_MODES } from "@/lib/constants";
import { MIN_EXPENSE_DATE, maxExpenseDate, todayIso, type IsoDate } from "@/lib/dates";
import type { ExpenseCategory } from "@/lib/expenses/queries";
import { currencyOf } from "@/lib/money";
import {
  CATEGORY_CREATE,
  CATEGORY_NAME_PREFIX,
  CATEGORY_NONE,
} from "@/lib/validations/expense";
import type { CurrencyCode } from "@/types";

export type ExpenseFormDefaults = {
  itemName?: string;
  /** As typed, not as a number — the form is a string surface. */
  amount?: string;
  expenseDate?: IsoDate;
  /** An existing category id, or "" for none. */
  category?: string;
  paymentMode?: string;
  notes?: string;
};

type ExpenseFormProps = {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  /** The user's own categories, for the select. */
  categories: ExpenseCategory[];
  /** Personal expenses are always paid by their owner (specification 45). */
  payerName: string;
  currencyCode: CurrencyCode;
  /** Today as the server sees it; corrected to the browser's day on mount. */
  serverToday: IsoDate;
  defaults?: ExpenseFormDefaults;
  submitLabel: string;
  cancelHref: string;
};

/**
 * The add/edit expense form (specification sections 7 and 36).
 *
 * Field order follows the specification's "quick entry" flow, and every
 * control is a native one, so the whole form works with a keyboard, with a
 * screen reader, and with the platform's own date and select pickers on
 * mobile.
 */
export function ExpenseForm({
  action,
  categories,
  payerName,
  currencyCode,
  serverToday,
  defaults,
  submitLabel,
  cancelHref,
}: ExpenseFormProps) {
  const [state, formAction, pending] = useActionState(action, idleFormState);
  const isNew = defaults?.expenseDate === undefined;

  const [category, setCategory] = useState(
    defaults?.category ?? CATEGORY_NONE,
  );
  const dateRef = useRef<HTMLInputElement>(null);

  const currency = currencyOf(currencyCode);

  // The server's "today" is its own calendar day, which can fall either side
  // of the visitor's. Correct the input once the browser can answer — only for
  // a new expense, and only while the field still holds the server's guess.
  useEffect(() => {
    const input = dateRef.current;

    if (!isNew || !input) {
      return;
    }

    const browserToday = todayIso();

    if (input.value === serverToday && browserToday !== serverToday) {
      input.value = browserToday;
    }
  }, [isNew, serverToday]);

  useEffect(() => {
    if (state.status === "error" && state.message) {
      toast.error(state.message, { id: "expense-form" });
    }
  }, [state]);

  const existingNames = new Set(
    categories.map((item) => item.name.trim().toLowerCase()),
  );
  const suggestions = DEFAULT_CATEGORIES.filter(
    (name) => !existingNames.has(name.toLowerCase()),
  );

  const creatingCategory = category === CATEGORY_CREATE;

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <FormField
        label="Item name"
        name="itemName"
        placeholder="Groceries"
        defaultValue={state.values?.itemName ?? defaults?.itemName}
        errors={state.fieldErrors?.itemName}
        maxLength={120}
        autoComplete="off"
        required
      />

      <Field
        name="amount"
        label="Amount"
        errors={state.fieldErrors?.amount}
        hint={`Amounts are recorded in ${currency.label} (${currency.code}).`}
      >
        <div className="relative">
          <span
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
          >
            {currency.symbol}
          </span>
          <Input
            name="amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0.01"
            placeholder="0.00"
            className="pl-8 tabular"
            defaultValue={state.values?.amount ?? defaults?.amount}
            {...fieldAria("amount", {
              hasHint: true,
              errors: state.fieldErrors?.amount,
            })}
            required
          />
        </div>
      </Field>

      <Field
        name="paidBy"
        label="Paid by"
        hint="Personal expenses are always your own. In a group you can choose who paid."
      >
        <Input
          readOnly
          value={payerName}
          className="cursor-default bg-muted text-muted-foreground"
          {...fieldAria("paidBy", { hasHint: true })}
        />
      </Field>

      <Field
        name="expenseDate"
        label="Date"
        errors={state.fieldErrors?.expenseDate}
      >
        <Input
          ref={dateRef}
          name="expenseDate"
          type="date"
          defaultValue={
            state.values?.expenseDate ?? defaults?.expenseDate ?? serverToday
          }
          min={MIN_EXPENSE_DATE}
          max={maxExpenseDate(serverToday)}
          className="tabular"
          {...fieldAria("expenseDate", { errors: state.fieldErrors?.expenseDate })}
          required
        />
      </Field>

      <Field
        name="category"
        label="Category"
        errors={state.fieldErrors?.category}
        hint="Optional. Picking a suggestion adds it to your categories."
      >
        <Select
          name="category"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          {...fieldAria("category", {
            hasHint: true,
            errors: state.fieldErrors?.category,
          })}
        >
          <option value={CATEGORY_NONE}>No category</option>

          {categories.length > 0 ? (
            <optgroup label="Your categories">
              {categories.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </optgroup>
          ) : null}

          {suggestions.length > 0 ? (
            <optgroup label="Suggested">
              {suggestions.map((name) => (
                <option key={name} value={`${CATEGORY_NAME_PREFIX}${name}`}>
                  {name}
                </option>
              ))}
            </optgroup>
          ) : null}

          <option value={CATEGORY_CREATE}>+ Create a new category</option>
        </Select>
      </Field>

      {creatingCategory ? (
        <Field
          name="newCategoryName"
          label="New category name"
          errors={state.fieldErrors?.newCategoryName}
        >
          <Input
            name="newCategoryName"
            placeholder="Weekend trips"
            maxLength={60}
            autoFocus
            defaultValue={state.values?.newCategoryName}
            {...fieldAria("newCategoryName", {
              errors: state.fieldErrors?.newCategoryName,
            })}
          />
        </Field>
      ) : null}

      <Field
        name="paymentMode"
        label="Payment mode"
        errors={state.fieldErrors?.paymentMode}
      >
        <Select
          name="paymentMode"
          defaultValue={state.values?.paymentMode ?? defaults?.paymentMode ?? ""}
          {...fieldAria("paymentMode", { errors: state.fieldErrors?.paymentMode })}
        >
          <option value="">Not recorded</option>
          {PAYMENT_MODES.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {mode.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field name="notes" label="Notes" errors={state.fieldErrors?.notes}>
        <Textarea
          name="notes"
          placeholder="Dinner with friends"
          maxLength={500}
          defaultValue={state.values?.notes ?? defaults?.notes}
          {...fieldAria("notes", { errors: state.fieldErrors?.notes })}
        />
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
