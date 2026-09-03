"use client";

import { ArchiveRestore, Archive, Pencil, Trash2 } from "lucide-react";
import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import {
  BudgetFigures,
  BudgetMeter,
  BudgetStatusBadge,
} from "@/components/budgets/budget-meter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Input } from "@/components/ui/input";
import { SubmitAction } from "@/components/ui/submit-action";
import { idleFormState, type FormState } from "@/lib/auth/form-state";
import type { CategoryBudget } from "@/lib/budgets/queries";
import { currencyOf, fromMinorUnits } from "@/lib/money";
import type { CurrencyCode } from "@/types";

/**
 * One category: what it is called, how its spending compares with its budget,
 * and — for whoever may manage it — the controls to change all three.
 *
 * Every action arrives already bound to its group (or to `null` for personal
 * categories) by the Server Component that renders this. Binding a Server
 * Action inside a Client Component produces one that never resolves, which
 * Phase 5 learned the hard way; the boundary is here, not below it.
 *
 * Every control is a real form in the rendered HTML — the rename sits inside a
 * native `<details>` rather than behind client state, so it posts and works
 * with JavaScript disabled, exactly as the archive, delete and budget controls
 * beside it do.
 */

export type CategoryFormAction = (
  state: FormState,
  formData: FormData,
) => Promise<FormState>;

export type CategoryRowActions = {
  setBudget: CategoryFormAction;
  clearBudget: CategoryFormAction;
  rename: CategoryFormAction;
  archive: CategoryFormAction;
  restore: CategoryFormAction;
  remove: CategoryFormAction;
};

export function CategoryRow({
  row,
  currencyCode,
  canManage,
  actions,
}: {
  row: CategoryBudget;
  currencyCode: CurrencyCode;
  /** False for a group member: they read budgets, admins set them. */
  canManage: boolean;
  actions: CategoryRowActions;
}) {
  const { category, progress } = row;

  return (
    <li className="flex flex-col gap-3 py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="truncate font-medium">{category.name}</h3>
          {category.is_archived ? <Badge>Archived</Badge> : null}
          {row.isMonthSpecific ? <Badge>Set for this month</Badge> : null}
        </div>

        <BudgetStatusBadge progress={progress} />
      </div>

      <div className="flex flex-col gap-2">
        <BudgetFigures progress={progress} currencyCode={currencyCode} />
        <BudgetMeter
          progress={progress}
          currencyCode={currencyCode}
          label={category.name}
        />
      </div>

      {canManage ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <BudgetForm
              action={actions.setBudget}
              categoryId={category.id}
              currencyCode={currencyCode}
              amount={progress.budget}
            />

            <div className="flex flex-wrap items-center gap-1">
              {progress.budget !== null ? (
                <SubmitAction
                  action={actions.clearBudget}
                  fields={{ categoryId: category.id }}
                  label="Clear budget"
                  ariaLabel={`Clear the budget for ${category.name}`}
                  variant="ghost"
                  toastId={`budget-clear-${category.id}`}
                />
              ) : null}

              {category.is_archived ? (
                <SubmitAction
                  action={actions.restore}
                  fields={{ categoryId: category.id }}
                  label="Restore"
                  ariaLabel={`Restore ${category.name}`}
                  icon={<ArchiveRestore aria-hidden />}
                  variant="ghost"
                  toastId={`category-restore-${category.id}`}
                />
              ) : (
                <SubmitAction
                  action={actions.archive}
                  fields={{ categoryId: category.id }}
                  label="Archive"
                  ariaLabel={`Archive ${category.name}`}
                  icon={<Archive aria-hidden />}
                  variant="ghost"
                  toastId={`category-archive-${category.id}`}
                />
              )}

              <ConfirmAction
                action={actions.remove}
                fields={{ categoryId: category.id }}
                label="Delete"
                ariaLabel={`Delete ${category.name}`}
                confirmLabel="Delete category"
                icon={<Trash2 aria-hidden />}
                toastId={`category-delete-${category.id}`}
              />
            </div>
          </div>

          <RenameForm
            action={actions.rename}
            categoryId={category.id}
            name={category.name}
          />
        </div>
      ) : null}
    </li>
  );
}

/**
 * The monthly budget for one category.
 *
 * Its own form, so saving one budget never touches another, and a rejected
 * amount reports against the field it was typed into.
 */
function BudgetForm({
  action,
  categoryId,
  currencyCode,
  amount,
}: {
  action: CategoryFormAction;
  categoryId: string;
  currencyCode: CurrencyCode;
  /** Minor units, or null when no budget is set. */
  amount: number | null;
}) {
  const [state, formAction, pending] = useActionState(action, idleFormState);
  const currency = currencyOf(currencyCode);
  const errors = state.fieldErrors?.amount;
  const inputId = `budget-${categoryId}`;

  useEffect(() => {
    if (state.status === "success" && state.message) {
      toast.success(state.message, { id: `budget-${categoryId}` });
    }

    if (state.status === "error" && state.message && !state.fieldErrors) {
      toast.error(state.message, { id: `budget-${categoryId}` });
    }
  }, [state, categoryId]);

  return (
    <form action={formAction} className="flex flex-col gap-1.5">
      <input type="hidden" name="categoryId" value={categoryId} />

      <label
        htmlFor={inputId}
        className="text-xs font-medium text-muted-foreground"
      >
        Monthly budget
      </label>

      <div className="flex items-center gap-2">
        <div className="relative w-40">
          <span
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
          >
            {currency.symbol}
          </span>
          <Input
            id={inputId}
            name="amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0.01"
            placeholder="0.00"
            className="h-9 pl-8 tabular"
            defaultValue={amount === null ? "" : String(fromMinorUnits(amount))}
            aria-invalid={errors?.length ? true : undefined}
            aria-describedby={errors?.length ? `${inputId}-error` : undefined}
          />
        </div>

        <Button type="submit" variant="secondary" size="sm" loading={pending}>
          Save
        </Button>
      </div>

      {errors?.length ? (
        <p
          id={`${inputId}-error`}
          role="alert"
          className="text-xs font-medium text-danger"
        >
          {errors.join(" ")}
        </p>
      ) : null}
    </form>
  );
}

/**
 * Renaming, behind a native disclosure.
 *
 * `<details>` rather than a piece of `useState`: it is keyboard accessible and
 * announced correctly with no code of ours, it collapses so a long list of
 * categories stays readable, and — because the form is in the document either
 * way — the rename still posts when JavaScript never arrives.
 */
function RenameForm({
  action,
  categoryId,
  name,
}: {
  action: CategoryFormAction;
  categoryId: string;
  name: string;
}) {
  const [state, formAction, pending] = useActionState(action, idleFormState);
  const inputId = `rename-${categoryId}`;
  const errors = state.fieldErrors?.name;

  useEffect(() => {
    if (state.status === "success" && state.message) {
      toast.success(state.message, { id: `category-rename-${categoryId}` });
    }

    if (state.status === "error" && state.message && !state.fieldErrors) {
      toast.error(state.message, { id: `category-rename-${categoryId}` });
    }
  }, [state, categoryId]);

  return (
    <details>
      <summary className="inline-flex w-fit cursor-pointer list-none items-center gap-2 rounded-md px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Pencil aria-hidden className="size-4" />
        Rename
      </summary>

      <form action={formAction} className="mt-2 flex flex-col gap-1.5">
        <input type="hidden" name="categoryId" value={categoryId} />

        <label htmlFor={inputId} className="sr-only">
          New name for {name}
        </label>

        <div className="flex items-center gap-2">
          <Input
            id={inputId}
            name="name"
            defaultValue={state.values?.name ?? name}
            maxLength={60}
            className="h-9 w-56"
            autoComplete="off"
            aria-invalid={errors?.length ? true : undefined}
            aria-describedby={errors?.length ? `${inputId}-error` : undefined}
            required
          />

          <Button type="submit" variant="secondary" size="sm" loading={pending}>
            Save name
          </Button>
        </div>

        {errors?.length ? (
          <p
            id={`${inputId}-error`}
            role="alert"
            className="text-xs font-medium text-danger"
          >
            {errors.join(" ")}
          </p>
        ) : null}
      </form>
    </details>
  );
}
