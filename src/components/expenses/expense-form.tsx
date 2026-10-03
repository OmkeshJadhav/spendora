"use client";

import { ChevronDown, Plus, X } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { Field, fieldAria } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useModalDismiss } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { idleFormState, type FormState } from "@/lib/auth/form-state";
import { DEFAULT_CATEGORIES, PAYMENT_MODES } from "@/lib/constants";
import { MIN_EXPENSE_DATE, maxExpenseDate, todayIso, type IsoDate } from "@/lib/dates";
import { ITEM_FIELDS, itemKey, type ItemField } from "@/lib/expenses/batch-form";
import type { ExpenseCategory } from "@/lib/expenses/queries";
import {
  currencyOf,
  formatCurrency,
  formatMinorUnits,
  toMinorUnits,
} from "@/lib/money";
import { cn } from "@/lib/utils";
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
  /** Today as the server sees it; replaced by the browser's day once hydrated. */
  serverToday: IsoDate;
  defaults?: ExpenseFormDefaults;
  /**
   * Offer "Add another item", so several expenses are recorded in one submit.
   * Each item has its own fields; only the payer is shared. Only for adding:
   * an edit changes exactly one expense.
   */
  multiple?: boolean;
  submitLabel: string;
  /** Where Cancel goes on a full page. Inside a modal, Cancel closes it. */
  cancelHref: string;
};

/**
 * One item row. `key` is stable across removals; the row's index is not.
 *
 * The values are held here rather than left to the DOM: React resets a form
 * after its action runs, and an uncontrolled row would refill from whichever
 * echoed values now share its index — after a removal, another row's.
 */
type ItemRow = {
  key: number;
  itemName: string;
  amount: string;
  /** Null until chosen, meaning "today" — the browser's, once it can say. */
  expenseDate: string | null;
  category: string;
  newCategoryName: string;
  paymentMode: string;
  notes: string;
};

const AMOUNT_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

const subscribeToNothing = () => () => {};

/**
 * The add/edit expense form (specification sections 7 and 36).
 *
 * Field order follows the specification's "quick entry" flow, and every
 * control is a native one, so the whole form works with a keyboard, with a
 * screen reader, and with the platform's own date and select pickers on
 * mobile.
 *
 * Adding several items, each sits in an accordion panel. Adding another
 * collapses the rest to their name and amount, so a long list stays short.
 * Collapsed panels are hidden, not unmounted, so their fields still submit.
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
  const dismissModal = useModalDismiss();

  // The server's "today" is its own calendar day, which can fall either side
  // of the visitor's. Rows that have not picked a date follow the browser's.
  const today = useSyncExternalStore(
    subscribeToNothing,
    todayIso,
    () => serverToday,
  );

  const [rows, setRows] = useState<ItemRow[]>([
    {
      key: 0,
      itemName: defaults?.itemName ?? "",
      amount: defaults?.amount ?? "",
      expenseDate: defaults?.expenseDate ?? null,
      category: defaults?.category ?? CATEGORY_NONE,
      newCategoryName: "",
      paymentMode: defaults?.paymentMode ?? "",
      notes: defaults?.notes ?? "",
    },
  ]);
  const nextKey = useRef(1);
  const [expandedKey, setExpandedKey] = useState<number | null>(0);
  // The row just added, whose item name takes focus as it mounts.
  const [focusKey, setFocusKey] = useState<number | null>(null);

  // Row errors are keyed by position. Once a row is removed they point at the
  // wrong rows, so they are hidden until the next submission replaces them.
  const [staleState, setStaleState] = useState<FormState | null>(null);
  const rowState = state === staleState ? idleFormState : state;

  const rowHasErrors = (index: number) =>
    ITEM_FIELDS.some(
      (field) => rowState.fieldErrors?.[itemKey(field, index)]?.length,
    );

  // A rejected submission opens the first item that needs fixing, so the
  // message is never inside a collapsed panel.
  const [seenState, setSeenState] = useState(state);

  if (state !== seenState) {
    setSeenState(state);
    const first = rows.findIndex((_, index) =>
      ITEM_FIELDS.some((field) => state.fieldErrors?.[itemKey(field, index)]),
    );

    if (multiple && first >= 0) {
      setExpandedKey(rows[first].key);
    }
  }

  useEffect(() => {
    if (state.status === "error" && state.message) {
      toast.error(state.message, { id: "expense-form" });
    }
  }, [state]);

  const currency = currencyOf(currencyCode);

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
    const previous = rows[rows.length - 1];

    // A new item starts on the previous one's date and payment mode — usually
    // the same trip — and either can be changed.
    setRows((current) => [
      ...current,
      {
        key,
        itemName: "",
        amount: "",
        expenseDate: previous?.expenseDate ?? null,
        category: CATEGORY_NONE,
        newCategoryName: "",
        paymentMode: previous?.paymentMode ?? "",
        notes: "",
      },
    ]);
    setExpandedKey(key);
    setFocusKey(key);
  }

  function removeRow(key: number) {
    const index = rows.findIndex((row) => row.key === key);
    const remaining = rows.filter((row) => row.key !== key);

    setRows(remaining);
    setStaleState(state);

    if (expandedKey === key) {
      setExpandedKey(remaining[Math.max(0, index - 1)]?.key ?? null);
    }
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
      {multiple ? (
        <div className="flex flex-col gap-3">
          {rows.map((row, index) => {
            const expanded = row.key === expandedKey;
            const panelId = `item-${row.key}-panel`;
            const amount = row.amount.trim();

            return (
              <div
                key={row.key}
                className={cn(
                  "rounded-md border",
                  rowHasErrors(index) ? "border-danger" : "border-border",
                )}
              >
                <div className="flex items-center gap-1 pr-2">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-4 py-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    onClick={() => setExpandedKey(expanded ? null : row.key)}
                  >
                    <ChevronDown
                      aria-hidden
                      className={cn(
                        "size-4 shrink-0 text-muted-foreground transition-transform",
                        expanded ? "rotate-180" : null,
                      )}
                    />
                    <span className="shrink-0 text-xs text-muted-foreground">
                      Item {index + 1}
                    </span>
                    <span
                      className={cn(
                        "truncate font-medium",
                        row.itemName.trim() ? null : "text-muted-foreground",
                      )}
                    >
                      {row.itemName.trim() || "Untitled item"}
                    </span>
                    {rowHasErrors(index) ? (
                      <span className="shrink-0 text-xs font-medium text-danger-strong">
                        Needs fixing
                      </span>
                    ) : null}
                    <span className="tabular ml-auto shrink-0 font-medium">
                      {AMOUNT_PATTERN.test(amount)
                        ? formatCurrency(Number(amount), currencyCode)
                        : "—"}
                    </span>
                  </button>

                  {rows.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="px-2"
                      onClick={() => removeRow(row.key)}
                      disabled={pending}
                      aria-label={`Remove item ${index + 1}`}
                    >
                      <X aria-hidden />
                    </Button>
                  ) : null}
                </div>

                <div
                  id={panelId}
                  hidden={!expanded}
                  className="border-t border-border p-4"
                >
                  <ItemFields
                    row={row}
                    index={index}
                    indexed
                    autoFocus={row.key === focusKey}
                    fieldErrors={rowState.fieldErrors}
                    categories={categories}
                    suggestions={suggestions}
                    canCreateCategories={canCreateCategories}
                    inGroup={Boolean(members)}
                    currencySymbol={currency.symbol}
                    today={today}
                    serverToday={serverToday}
                    onChange={(patch) => updateRow(row.key, patch)}
                  />
                </div>
              </div>
            );
          })}

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
            {amountHint} {categoryHint}
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
      ) : (
        <ItemFields
          row={rows[0]}
          index={0}
          // A single row keeps the original field ids and error keys, which is
          // what the edit actions read and report.
          indexed={false}
          autoFocus={false}
          fieldErrors={state.fieldErrors}
          categories={categories}
          suggestions={suggestions}
          canCreateCategories={canCreateCategories}
          inGroup={Boolean(members)}
          currencySymbol={currency.symbol}
          amountHint={amountHint}
          categoryHint={categoryHint}
          today={today}
          serverToday={serverToday}
          onChange={(patch) => updateRow(rows[0].key, patch)}
        />
      )}

      {members ? (
        <Field
          name="paidBy"
          label="Paid by"
          errors={state.fieldErrors?.paidBy}
          hint={
            multiple
              ? "Applies to every item. Any member of this group can be recorded as having paid."
              : "Any member of this group can be recorded as having paid."
          }
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

      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" loading={pending}>
          {rows.length > 1 ? `Save ${rows.length} expenses` : submitLabel}
        </Button>
        {dismissModal ? (
          <Button type="button" variant="ghost" onClick={dismissModal}>
            Cancel
          </Button>
        ) : (
          <Link
            href={cancelHref}
            className={buttonVariants({ variant: "ghost", size: "md" })}
          >
            Cancel
          </Link>
        )}
      </div>
    </form>
  );
}

type ItemFieldsProps = {
  row: ItemRow;
  index: number;
  indexed: boolean;
  autoFocus: boolean;
  fieldErrors?: Record<string, string[]>;
  categories: ExpenseCategory[];
  suggestions: readonly string[];
  canCreateCategories: boolean;
  inGroup: boolean;
  currencySymbol: string;
  amountHint?: string;
  categoryHint?: string;
  today: IsoDate;
  serverToday: IsoDate;
  onChange: (patch: Partial<ItemRow>) => void;
};

/**
 * One item's fields: everything an expense has except who paid.
 *
 * Every row submits the same input names, so the server reads the rows as
 * parallel lists (see `lib/expenses/batch-form.ts`). Ids and errors are per
 * row, keyed by the row's position.
 */
function ItemFields({
  row,
  index,
  indexed,
  autoFocus,
  fieldErrors,
  categories,
  suggestions,
  canCreateCategories,
  inGroup,
  currencySymbol,
  amountHint,
  categoryHint,
  today,
  serverToday,
  onChange,
}: ItemFieldsProps) {
  const key = (field: ItemField) => (indexed ? itemKey(field, index) : field);
  const id = (field: ItemField) => (indexed ? `${field}-${index}` : field);
  const errorsOf = (field: ItemField) => fieldErrors?.[key(field)];

  const creatingCategory =
    canCreateCategories && row.category === CATEGORY_CREATE;
  const pair = indexed
    ? "grid gap-4 sm:grid-cols-2"
    : "flex flex-col gap-5";

  return (
    <div className={cn("flex flex-col", indexed ? "gap-4" : "gap-5")}>
      <div
        className={
          indexed ? "grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]" : pair
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

      <div className={pair}>
        <Field
          name={id("expenseDate")}
          label="Date"
          errors={errorsOf("expenseDate")}
        >
          <Input
            name="expenseDate"
            type="date"
            value={row.expenseDate ?? today}
            onChange={(event) => onChange({ expenseDate: event.target.value })}
            min={MIN_EXPENSE_DATE}
            max={maxExpenseDate(serverToday)}
            className="tabular"
            {...fieldAria(id("expenseDate"), {
              errors: errorsOf("expenseDate"),
            })}
            required
          />
        </Field>

        <Field
          name={id("paymentMode")}
          label="Payment mode"
          errors={errorsOf("paymentMode")}
        >
          <Select
            name="paymentMode"
            value={row.paymentMode}
            onChange={(event) => onChange({ paymentMode: event.target.value })}
            {...fieldAria(id("paymentMode"), {
              errors: errorsOf("paymentMode"),
            })}
          >
            <option value="">Not recorded</option>
            {PAYMENT_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </Select>
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

      <Field name={id("notes")} label="Notes" errors={errorsOf("notes")}>
        <Textarea
          name="notes"
          placeholder="Dinner with friends"
          maxLength={500}
          value={row.notes}
          onChange={(event) => onChange({ notes: event.target.value })}
          {...fieldAria(id("notes"), { errors: errorsOf("notes") })}
        />
      </Field>
    </div>
  );
}
