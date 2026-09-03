"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";

import { getUser } from "@/lib/auth/dal";
import { unexpectedErrorMessage } from "@/lib/auth/errors";
import type { FormState } from "@/lib/auth/form-state";
import { withFlash } from "@/lib/flash";
import { createClient } from "@/lib/supabase/server";
import {
  groupExpenseSchema,
  type CategoryChoice,
} from "@/lib/validations/expense";
import type { CurrencyCode } from "@/types";
import type { Database } from "@/types/database";

/**
 * Group expense mutations (specification sections 7, 9 and 45).
 *
 * As with every Server Action here: the input is re-validated, the user is
 * re-derived from the session, and the group id is treated as a claim about
 * *which* group, never about the right to act on it. That right is the
 * database's to grant —
 *
 *   - inserting needs membership of the group (`expenses_insert_owner_or_member`),
 *   - editing and deleting need authorship of the row or admin of the group
 *     (`expenses_update_author_or_admin`, `expenses_delete_author_or_admin`),
 *   - `paid_by` must be a current member (the `expenses_check_paid_by` trigger),
 *   - the currency must be the group's (a composite foreign key),
 *   - `user_id` and `group_id` cannot be changed by an update at all
 *     (`expenses_pin_identity`), so a group expense cannot be re-parented into
 *     somebody's private records.
 *
 * The messages below explain a refusal. They are not what causes it.
 */

const GROUPS_PATH = "/groups";

type Client = SupabaseClient<Database>;

function groupExpensesPath(groupId: string): string {
  return `${GROUPS_PATH}/${groupId}/expenses`;
}

function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    (fieldErrors[key] ??= []).push(issue.message);
  }

  return fieldErrors;
}

/** The submitted values, echoed back so a rejected form keeps its content. */
function readForm(formData: FormData) {
  return {
    itemName: String(formData.get("itemName") ?? ""),
    amount: String(formData.get("amount") ?? ""),
    paidBy: String(formData.get("paidBy") ?? ""),
    expenseDate: String(formData.get("expenseDate") ?? ""),
    category: String(formData.get("category") ?? ""),
    newCategoryName: String(formData.get("newCategoryName") ?? ""),
    paymentMode: String(formData.get("paymentMode") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  };
}

const SESSION_EXPIRED: FormState = {
  status: "error",
  message: "Your session has expired. Please sign in again.",
};

/** Raised when the category the form asked for cannot be used. */
class CategoryError extends Error {}

/**
 * Turns the form's category selection into one of this group's category ids.
 *
 * Creating a category is admin-only (specification section 14), and that is
 * enforced by `categories_insert_owner_or_admin` rather than by a role check
 * here: the insert is attempted and a refusal becomes a sentence a member can
 * act on. Members always have every existing category to choose from, and may
 * leave the field empty.
 */
async function resolveGroupCategoryId(
  supabase: Client,
  groupId: string,
  choice: CategoryChoice,
): Promise<string | null> {
  if (choice.kind === "none") {
    return null;
  }

  const { data: owned, error } = await supabase
    .from("categories")
    .select("id, name, is_archived")
    .eq("group_id", groupId);

  if (error) {
    console.error("[group-expenses:resolveCategory]", error.message);
    throw new CategoryError(
      "We couldn't load this group's categories. Please try again.",
    );
  }

  const categories = owned ?? [];

  if (choice.kind === "existing") {
    const match = categories.find((category) => category.id === choice.id);

    // An id that is not one of this group's is a tampered form, not a typo.
    if (!match) {
      throw new CategoryError("Choose a category from the list.");
    }

    if (match.is_archived) {
      await unarchive(supabase, match.id);
    }

    return match.id;
  }

  // Names are unique per group on `lower(btrim(name))`; match the same way.
  const wanted = choice.name.trim().toLowerCase();
  const existing = categories.find(
    (category) => category.name.trim().toLowerCase() === wanted,
  );

  if (existing) {
    if (existing.is_archived) {
      await unarchive(supabase, existing.id);
    }

    return existing.id;
  }

  const { data: created, error: insertError } = await supabase
    .from("categories")
    .insert({ group_id: groupId, name: choice.name })
    .select("id")
    .single();

  if (insertError) {
    // 23505: another request created the same name first. Use theirs. The
    // match is redone in JavaScript rather than with `ilike`, where `%` and
    // `_` in a user-supplied name would behave as wildcards.
    if (insertError.code === "23505") {
      const { data: raced } = await supabase
        .from("categories")
        .select("id, name")
        .eq("group_id", groupId);

      const winner = (raced ?? []).find(
        (category) => category.name.trim().toLowerCase() === wanted,
      );

      if (winner) {
        return winner.id;
      }
    }

    if (insertError.code === "42501") {
      throw new CategoryError(
        "Only a group admin can add categories. Choose one from the list, or ask an admin to add it.",
      );
    }

    console.error("[group-expenses:createCategory]", insertError.message);
    throw new CategoryError("We couldn't create that category. Please try again.");
  }

  return created.id;
}

async function unarchive(supabase: Client, id: string): Promise<void> {
  const { error } = await supabase
    .from("categories")
    .update({ is_archived: false })
    .eq("id", id);

  if (error) {
    if (error.code === "42501") {
      throw new CategoryError(
        "That category has been archived, and only a group admin can bring it back. Choose another.",
      );
    }

    console.error("[group-expenses:unarchiveCategory]", error.message);
    throw new CategoryError("We couldn't use that category. Please try again.");
  }
}

/** Maps a database rejection to copy a user can act on. */
function writeFailureMessage(
  code: string | undefined,
  message: string,
  context: string,
): string {
  console.error(`[group-expenses:${context}]`, { code, message });

  switch (code) {
    case "42501":
      return "You don't have permission to change this expense. Only the person who recorded it, or a group admin, can.";
    case "23514":
      return "Those details were rejected. Check the amount and try again.";
    case "23503":
      // The paid-by trigger raises a foreign-key violation with its own text.
      return message.includes("Paid by")
        ? "The person you chose is no longer a member of this group."
        : "That category is no longer available. Choose another.";
    default:
      return "We couldn't save this expense. Please try again.";
  }
}

/** The group's currency, which every expense in it must carry (section 10). */
async function groupCurrency(
  supabase: Client,
  groupId: string,
): Promise<CurrencyCode | null> {
  const { data, error } = await supabase
    .from("groups")
    .select("currency_code")
    .eq("id", groupId)
    .maybeSingle();

  if (error) {
    console.error("[group-expenses:currency]", error.message);
    return null;
  }

  return data?.currency_code ?? null;
}

export async function createGroupExpense(
  groupId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const raw = readForm(formData);
  const parsed = groupExpenseSchema.safeParse(raw);

  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: fieldErrorsOf(parsed.error),
      values: raw,
    };
  }

  try {
    const user = await getUser();

    if (!user) {
      return SESSION_EXPIRED;
    }

    const supabase = await createClient();
    const currencyCode = await groupCurrency(supabase, groupId);

    // A group the user cannot read is a group they cannot add to. RLS would
    // refuse the insert too; this fails first, with something to read.
    if (!currencyCode) {
      return {
        status: "error",
        message: "That group is no longer available.",
        values: raw,
      };
    }

    const input = parsed.data;
    const categoryId = await resolveGroupCategoryId(
      supabase,
      groupId,
      input.category,
    );

    const { error } = await supabase.from("expenses").insert({
      // The recorder is always the session's user; the payer is chosen.
      user_id: user.id,
      group_id: groupId,
      paid_by: input.paidBy,
      category_id: categoryId,
      item_name: input.itemName,
      amount: input.amount,
      currency_code: currencyCode,
      expense_date: input.expenseDate,
      payment_mode: input.paymentMode,
      notes: input.notes,
    });

    if (error) {
      return {
        status: "error",
        message: writeFailureMessage(error.code, error.message, "create"),
        values: raw,
      };
    }
  } catch (error) {
    if (error instanceof CategoryError) {
      return { status: "error", message: error.message, values: raw };
    }

    return {
      status: "error",
      message: unexpectedErrorMessage(error, "group-expenses:create"),
      values: raw,
    };
  }

  revalidatePath(groupExpensesPath(groupId));
  revalidatePath(`${GROUPS_PATH}/${groupId}`);
  // redirect() throws to unwind, so it must sit outside the try block.
  redirect(withFlash(groupExpensesPath(groupId), "expense-created"));
}

export async function updateGroupExpense(
  groupId: string,
  expenseId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const raw = readForm(formData);
  const parsed = groupExpenseSchema.safeParse(raw);

  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: fieldErrorsOf(parsed.error),
      values: raw,
    };
  }

  try {
    const user = await getUser();

    if (!user) {
      return SESSION_EXPIRED;
    }

    const supabase = await createClient();
    const input = parsed.data;
    const categoryId = await resolveGroupCategoryId(
      supabase,
      groupId,
      input.category,
    );

    const { data, error } = await supabase
      .from("expenses")
      .update({
        paid_by: input.paidBy,
        category_id: categoryId,
        item_name: input.itemName,
        amount: input.amount,
        expense_date: input.expenseDate,
        payment_mode: input.paymentMode,
        notes: input.notes,
      })
      .eq("id", expenseId)
      // Scoped to this group, so a personal expense or one from another group
      // cannot be reached through this form. Who may edit it is RLS's answer.
      .eq("group_id", groupId)
      .select("id");

    if (error) {
      return {
        status: "error",
        message: writeFailureMessage(error.code, error.message, "update"),
        values: raw,
      };
    }

    // No row changed: it is gone, or the policy refused this user. PostgREST
    // reports both as an empty result, and so should we.
    if (!data || data.length === 0) {
      return {
        status: "error",
        message:
          "That expense could not be updated. It may have been deleted, or you may not have permission to change it.",
        values: raw,
      };
    }
  } catch (error) {
    if (error instanceof CategoryError) {
      return { status: "error", message: error.message, values: raw };
    }

    return {
      status: "error",
      message: unexpectedErrorMessage(error, "group-expenses:update"),
      values: raw,
    };
  }

  revalidatePath(groupExpensesPath(groupId));
  revalidatePath(`${GROUPS_PATH}/${groupId}`);
  redirect(withFlash(groupExpensesPath(groupId), "expense-updated"));
}

export async function deleteGroupExpense(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const groupId = String(formData.get("groupId") ?? "");
  const expenseId = String(formData.get("id") ?? "");

  if (!groupId || !expenseId) {
    return { status: "error", message: "That expense no longer exists." };
  }

  try {
    const user = await getUser();

    if (!user) {
      return SESSION_EXPIRED;
    }

    const supabase = await createClient();

    const { data, error } = await supabase
      .from("expenses")
      .delete()
      .eq("id", expenseId)
      .eq("group_id", groupId)
      .select("id");

    if (error) {
      return {
        status: "error",
        message: writeFailureMessage(error.code, error.message, "delete"),
      };
    }

    if (!data || data.length === 0) {
      return {
        status: "error",
        message:
          "That expense could not be deleted. It may already be gone, or you may not have permission to remove it.",
      };
    }
  } catch (error) {
    return {
      status: "error",
      message: unexpectedErrorMessage(error, "group-expenses:delete"),
    };
  }

  revalidatePath(groupExpensesPath(groupId));
  revalidatePath(`${GROUPS_PATH}/${groupId}`);
  redirect(withFlash(groupExpensesPath(groupId), "expense-deleted"));
}
