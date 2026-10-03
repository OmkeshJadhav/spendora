import type { z } from "zod";

import {
  CATEGORY_CREATE,
  type CategoryChoice,
} from "@/lib/validations/expense";

/**
 * Reading a multi-item "add expenses" form.
 *
 * Each item row submits `itemName`, `amount` and `category`, so the rows arrive
 * as parallel lists in document order. `newCategoryName` is only rendered for
 * a row creating a category, so its values belong, in order, to those rows. A
 * form with a single row is indistinguishable from the original one-item form.
 *
 * Field errors for a row are keyed `<field>.<index>`, so the form can put each
 * message back beside the row it belongs to. The rows' values are not echoed:
 * the form holds them in state, which survives a rejected submission.
 */

export const ITEM_FIELDS = [
  "itemName",
  "amount",
  "category",
  "newCategoryName",
] as const;

export type ItemField = (typeof ITEM_FIELDS)[number];
export type RawItem = Record<ItemField, string>;

export function itemKey(field: ItemField, index: number): string {
  return `${field}.${index}`;
}

/**
 * The submitted rows, or null when they cannot be lined up — a stale or
 * hand-built form, since the real one never sends them uneven.
 */
export function readItems(formData: FormData): RawItem[] | null {
  const list = (field: ItemField) =>
    formData.getAll(field).map((value) => String(value));

  const names = list("itemName");
  const amounts = list("amount");
  const categories = list("category");
  const newNames = list("newCategoryName");
  const count = names.length;

  if (amounts.length !== count || categories.length !== count) {
    return null;
  }

  // One new name per row (the single-item form's shape), or one per row that
  // is creating a category, in order.
  const creating = categories.filter((value) => value === CATEGORY_CREATE).length;
  const perRow = newNames.length === count;

  if (!perRow && newNames.length !== creating) {
    return null;
  }

  let nextNewName = 0;

  return names.map((itemName, index) => ({
    itemName,
    amount: amounts[index],
    category: categories[index],
    newCategoryName: perRow
      ? newNames[index]
      : categories[index] === CATEGORY_CREATE
        ? newNames[nextNewName++]
        : "",
  }));
}

/**
 * Zod issues keyed the way the form reads them: shared fields by name, item
 * fields by `<field>.<index>`, and anything about the list as a whole under
 * `items`.
 */
export function batchFieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const [head, index, field] = issue.path;
    const key =
      head === "items" && typeof index === "number" && field !== undefined
        ? itemKey(field as ItemField, index)
        : String(head ?? "form");

    (fieldErrors[key] ??= []).push(issue.message);
  }

  return fieldErrors;
}

/** The first list-level problem, worded for the toast. */
export function batchMessage(fieldErrors: Record<string, string[]>): string {
  return fieldErrors.items?.[0] ?? "Please fix the highlighted fields.";
}

/**
 * Resolves each distinct category choice once.
 *
 * Several rows picking the same suggestion, or typing the same new name,
 * should create one category rather than race each other to create it twice.
 */
export async function resolveCategoryIds(
  choices: CategoryChoice[],
  resolve: (choice: CategoryChoice) => Promise<string | null>,
): Promise<(string | null)[]> {
  const resolved = new Map<string, string | null>();
  const ids: (string | null)[] = [];

  for (const choice of choices) {
    const key =
      choice.kind === "none"
        ? "none"
        : choice.kind === "existing"
          ? `id:${choice.id}`
          : `name:${choice.name.trim().toLowerCase()}`;

    if (!resolved.has(key)) {
      resolved.set(key, await resolve(choice));
    }

    ids.push(resolved.get(key) ?? null);
  }

  return ids;
}
