"use client";

import { Plus, X } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { Field, fieldAria } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { idleFormState, type FormState } from "@/lib/auth/form-state";
import { DEFAULT_CATEGORIES, PAYMENT_MODES } from "@/lib/constants";
import { MIN_EXPENSE_DATE, maxExpenseDate, todayIso, type IsoDate } from "@/lib/dates";
import { itemKey, type ItemField } from "@/lib/expenses/batch-form";
import type { ExpenseCategory } from "@/lib/expenses/queries";
import { currencyOf, formatMinorUnits, toMinorUnits } from "@/lib/money";
import {
  CATEGORY_CREATE,
  CATEGORY_NAME_PREFIX,
  CATEGORY_NONE,
  MAX_ITEMS_PER_ENTRY,
} from "@/lib/validations/expense";
import type { CurrencyCode } from "@/types";

export type ExpenseFormDefaults = {
  itemName?: string;
  /** As typed, not as a number — the form is a string surface. */
  amount?: string;
  expenseDate?: IsoDate;
  /** An existing category id, or "" for none. */
  category?: string;
  /** A group member's user id. Ignored for a personal expense. */
  paidBy?: string;
  paymentMode?: string;
  notes?: string;
};

/** Someone who can be recorded as having paid, in a group. */
export type PayerOption = { id: string; name: string; isSelf: boolean };

type ExpenseFormProps = {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  /** The categories available here: the user's own, or the group's. */
  categories: ExpenseCategory[];
  /** Personal expenses are always paid by their owner (specification 45). */
  payerName: string;
  /**
   * The group's members. Given, the form offers a "Paid by" picker
   * (specification 7); omitted, the expense is personal and the payer is
   * fixed, which the database enforces as well.
   */
  members?: PayerOption[];
  /**
   * Whether this user may add a category here. False for a group member, since
   * group categories are admin-managed (specification 14) — the control is
   * hidden rather than offered and then refused.
   */
  canCreateCategories?: boolean;
  currencyCode: CurrencyCode;
  /** Today as the server sees it; corrected to the browser's day on mount. */
  serverToday: IsoDate;
  defaults?: ExpenseFormDefaults;
  /**
   * Offer "Add another item", so several expenses sharing a date, payer and
   * payment mode are recorded in one submit. Only for adding: an edit changes
   * exactly one expense.
   */
  multiple?: boolean;
  submitLabel: string;
  cancelHref: string;
};

/**
 * One item row. `key` is stable across removals; the row's index is not.
 *
 * The values are held here rather than left to the DOM: React resets a form
 * after its action runs, and an uncontrolled row would refill from whichever
 * echoed values now share its index — after a removal, another row's.
 */
type ItemRow = { key: number } & Record<ItemField, string>;

function blankRow(key: number): ItemRow {
  return {
    key,
    itemName: "",
    amount: "",
    category: CATEGORY_NONE,
    newCategoryName: "",
  };
}

const AMOUNT_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

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
  members,
  canCreateCategories = true,
  currencyCode,
  serverToday,
  defaults,
  multiple = false,
  submitLabel,
  cancelHref,
}: ExpenseFormProps) {
  const [state, formAction, pending] = useActionState(action, idleFormState);
  const isNew = defaults?.expenseDate === undefined;

  const [rows, setRows] = useState<ItemRow[]>([
    {
      ...blankRow(0),
      itemName: defaults?.itemName ?? "",
      amount: defaults?.amount ?? "",
      category: defaults?.category ?? CATEGORY_NONE,
    },
  ]);
  const nextKey = useRef(1);
  // The row just added, whose item name takes focus as it mounts.
  const [focusKey, setFocusKey] = useState<number | null>(null);
  // Row errors are keyed by position. Once a row is removed they point at the
  // wrong rows, so they are hidden until the next submission replaces them.
  const [staleState, setStaleState] = useState<FormState | null>(null);
  const rowState = state === staleState ? idleFormState : state;
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
  const suggestions = canCreateCategories
    ? DEFAULT_CATEGORIES.filter((name) => !existingNames.has(name.toLowerCase()))
    : [];

  const categoryHint = !canCreateCategories
    ? "Optional. Only a group admin can add categories."
    : members
      ? "Optional. Picking a suggestion adds it to this group's categories."
      : "Optional. Picking a suggestion adds it to your categories.";
  const amountHint = `Amounts are recorded in ${currency.label} (${currency.code}).`;

  function updateRow(key: number, patch: Partial<ItemRow>) {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  function addRow() {
    const key = nextKey.current++;
    setRows((current) => [...current, blankRow(key)]);
    setFocusKey(key);
  }

  function removeRow(key: number) {
    setRows((current) => current.filter((row) => row.key !== key));
    setStaleState(state);
  }

  // In minor units, so ten items of ₹0.10 total ₹1.00 and not ₹0.9999….
  const totalMinor = rows.reduce(
    (total, row) =>
      AMOUNT_PATTERN.test(row.amount.trim())
        ? total + toMinorUnits(Number(row.amount))
        : total,
    0,
  );

  const listMessage = state.fieldErrors?.items;
  const canAdd = multiple && rows.length < MAX_ITEMS_PER_ENTRY;

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {rows.map((row, index) => (
        <ItemFields
          key={row.key}
          row={row}
          index={index}
          // A single row keeps the original field ids and error keys, which is
          // what the edit actions read and report.
          indexed={multiple}
          removable={multiple && rows.length > 1}
          autoFocus={row.key === focusKey}
          fieldErrors={rowState.fieldErrors}
          categories={categories}
          suggestions={suggestions}
          canCreateCategories={canCreateCategories}
          inGroup={Boolean(members)}
          currencySymbol={currency.symbol}
          amountHint={multiple ? undefined : amountHint}
          categoryHint={multiple ? undefined : categoryHint}
          disabled={pending}
          onChange={(patch) => updateRow(row.key, patch)}
          onRemove={() => removeRow(row.key)}
        />
      ))}

      {multiple ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={addRow}
              disabled={!canAdd || pending}
            >
              <Plus aria-hidden />
              Add another item
            </Button>

            {rows.length > 1 ? (
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {rows.length} items · Total{" "}
                <span className="tabular font-medium text-foreground">
                  {formatMinorUnits(totalMinor, currencyCode)}
                </span>
              </p>
            ) : null}
          </div>

          <p className="text-xs text-muted-foreground">
            {amountHint} {categoryHint} The details below apply to every item.
            {rows.length >= MAX_ITEMS_PER_ENTRY
              ? ` You can add up to ${MAX_ITEMS_PER_ENTRY} items at a time.`
              : ""}
          </p>

          {listMessage?.length ? (
            <p role="alert" className="text-xs font-medium text-danger-strong">
              {listMessage.join(" ")}
            </p>
          ) : null}
        </div>
      ) : null}

      {members ? (
        <Field
          name="paidBy"
          label="Paid by"
          errors={state.fieldErrors?.paidBy}
          hint="Any member of this group can be recorded as having paid."
        >
          <Select
            name="paidBy"
            defaultValue={
              state.values?.paidBy ??
              defaults?.paidBy ??
              (members.find((member) => member.isSelf)?.id ?? members[0]?.id)
            }
            {...fieldAria("paidBy", {
              hasHint: true,
              errors: state.fieldErrors?.paidBy,
            })}
            required
          >
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.isSelf ? `${member.name} (you)` : member.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
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
      )}

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
          {rows.length > 1 ? `Save ${rows.length} expenses` : submitLabel}
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

type ItemFieldsProps = {
  row: ItemRow;
  index: number;
  indexed: boolean;
  removable: boolean;
  autoFocus: boolean;
  fieldErrors?: Record<string, string[]>;
  categories: ExpenseCategory[];
  suggestions: readonly string[];
  canCreateCategories: boolean;
  inGroup: boolean;
  currencySymbol: string;
  amountHint?: string;
  categoryHint?: string;
  disabled: boolean;
  onChange: (patch: Partial<ItemRow>) => void;
  onRemove: () => void;
};

/**
 * One item's name, amount and category.
 *
 * Every row submits the same input names, so the server reads the rows as
 * parallel lists (see `lib/expenses/batch-form.ts`). Ids and errors are per
 * row, keyed by the row's position.
 */
function ItemFields({
  row,
  index,
  indexed,
  removable,
  autoFocus,
  fieldErrors,
  categories,
  suggestions,
  canCreateCategories,
  inGroup,
  currencySymbol,
  amountHint,
  categoryHint,
  disabled,
  onChange,
  onRemove,
}: ItemFieldsProps) {
  const key = (field: ItemField) => (indexed ? itemKey(field, index) : field);
  const id = (field: ItemField) => (indexed ? `${field}-${index}` : field);
  const errorsOf = (field: ItemField) => fieldErrors?.[key(field)];

  const creatingCategory =
    canCreateCategories && row.category === CATEGORY_CREATE;

  const fields = (
    <>
      <div
        className={
          indexed
            ? "grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]"
            : "flex flex-col gap-5"
        }
      >
        <Field
          name={id("itemName")}
          label="Item name"
          errors={errorsOf("itemName")}
        >
          <Input
            name="itemName"
            placeholder="Groceries"
            value={row.itemName}
            onChange={(event) => onChange({ itemName: event.target.value })}
            maxLength={120}
            autoComplete="off"
            autoFocus={autoFocus}
            {...fieldAria(id("itemName"), { errors: errorsOf("itemName") })}
            required
          />
        </Field>

        <Field
          name={id("amount")}
          label="Amount"
          errors={errorsOf("amount")}
          hint={amountHint}
        >
          <div className="relative">
            <span
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
            >
              {currencySymbol}
            </span>
            <Input
              name="amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              placeholder="0.00"
              className="pl-8 tabular"
              value={row.amount}
              onChange={(event) => onChange({ amount: event.target.value })}
              {...fieldAria(id("amount"), {
                hasHint: Boolean(amountHint),
                errors: errorsOf("amount"),
              })}
              required
            />
          </div>
        </Field>
      </div>

      <Field
        name={id("category")}
        label="Category"
        errors={errorsOf("category")}
        hint={categoryHint}
      >
        <Select
          name="category"
          value={row.category}
          onChange={(event) => onChange({ category: event.target.value })}
          {...fieldAria(id("category"), {
            hasHint: Boolean(categoryHint),
            errors: errorsOf("category"),
          })}
        >
          <option value={CATEGORY_NONE}>No category</option>

          {categories.length > 0 ? (
            <optgroup label={inGroup ? "Group categories" : "Your categories"}>
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

          {canCreateCategories ? (
            <option value={CATEGORY_CREATE}>+ Create a new category</option>
          ) : null}
        </Select>
      </Field>

      {creatingCategory ? (
        <Field
          name={id("newCategoryName")}
          label="New category name"
          errors={errorsOf("newCategoryName")}
        >
          <Input
            name="newCategoryName"
            placeholder="Weekend trips"
            maxLength={60}
            autoFocus
            value={row.newCategoryName}
            onChange={(event) =>
              onChange({ newCategoryName: event.target.value })
            }
            {...fieldAria(id("newCategoryName"), {
              errors: errorsOf("newCategoryName"),
            })}
          />
        </Field>
      ) : null}
    </>
  );

  if (!indexed) {
    return fields;
  }

  return (
    <div
      role="group"
      aria-labelledby={`item-${index}-heading`}
      className="flex flex-col gap-4 rounded-md border border-border p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <p id={`item-${index}-heading`} className="text-sm font-medium">
          Item {index + 1}
        </p>
        {removable ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-my-1 -mr-2 px-2"
            onClick={onRemove}
            disabled={disabled}
            aria-label={`Remove item ${index + 1}`}
          >
            <X aria-hidden />
          </Button>
        ) : null}
      </div>
      {fields}
    </div>
  );
}
