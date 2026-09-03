"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";

import { getUser } from "@/lib/auth/dal";
import { unexpectedErrorMessage } from "@/lib/auth/errors";
import type { FormState } from "@/lib/auth/form-state";
import { DEFAULT_CURRENCY_CODE } from "@/lib/constants";
import { withFlash } from "@/lib/flash";
import { createClient } from "@/lib/supabase/server";
import { expenseSchema, type CategoryChoice } from "@/lib/validations/expense";
import type { Database } from "@/types/database";

/**
 * Personal expense mutations.
 *
 * Server Actions are public POST endpoints, so each one re-validates its input
 * and re-derives the user from the session. Nothing identifying comes from the
 * form: `user_id` and `paid_by` are always the session's user, and the row is
 * matched on that user before it can be changed or removed. RLS enforces the
 * same rules a second time in the database.
 */

const EXPENSES_PATH = "/expenses";
const DASHBOARD_PATH = "/dashboard";

type Client = SupabaseClient<Database>;

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
 * Turns the form's category selection into a category id.
 *
 * A name that does not exist yet is created as a personal category, which is
 * what makes the suggested defaults usable without a separate setup step
 * (specification section 13: defaults are offered, never forced).
 */
async function resolveCategoryId(
  supabase: Client,
  userId: string,
  choice: CategoryChoice,
): Promise<string | null> {
  if (choice.kind === "none") {
    return null;
  }

  const { data: owned, error } = await supabase
    .from("categories")
    .select("id, name, is_archived")
    .eq("user_id", userId);

  if (error) {
    console.error("[expenses:resolveCategory]", error.message);
    throw new CategoryError("We couldn't load your categories. Please try again.");
  }

  const categories = owned ?? [];

  if (choice.kind === "existing") {
    const match = categories.find((category) => category.id === choice.id);

    // An id that is not the user's own is a tampered form, not a typo.
    if (!match) {
      throw new CategoryError("Choose a category from the list.");
    }

    if (match.is_archived) {
      await unarchive(supabase, match.id);
    }

    return match.id;
  }

  // Names are unique per user on `lower(btrim(name))`; match the same way.
  const wanted = choice.name.trim().toLowerCase();
  const existing = categories.find(
    (category) => category.name.trim().toLowerCase() === wanted,
  );

  if (existing) {
    // Re-using a name the user had archived means they want it back.
    if (existing.is_archived) {
      await unarchive(supabase, existing.id);
    }

    return existing.id;
  }

  const { data: created, error: insertError } = await supabase
    .from("categories")
    .insert({ user_id: userId, name: choice.name })
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
        .eq("user_id", userId);

      const winner = (raced ?? []).find(
        (category) => category.name.trim().toLowerCase() === wanted,
      );

      if (winner) {
        return winner.id;
      }
    }

    console.error("[expenses:createCategory]", insertError.message);
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
    console.error("[expenses:unarchiveCategory]", error.message);
    throw new CategoryError("We couldn't use that category. Please try again.");
  }
}

/** Maps a database rejection to copy a user can act on. */
function writeFailureMessage(code: string | undefined, message: string): string {
  console.error("[expenses:write]", { code, message });

  switch (code) {
    case "23514":
      return "Those details were rejected. Check the amount and try again.";
    case "23503":
      return "That category is no longer available. Choose another.";
    case "42501":
      return "You don't have permission to change this expense.";
    default:
      return "We couldn't save this expense. Please try again.";
  }
}

export async function createExpense(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const raw = readForm(formData);
  const parsed = expenseSchema.safeParse(raw);

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
    const categoryId = await resolveCategoryId(supabase, user.id, input.category);

    const { error } = await supabase.from("expenses").insert({
      user_id: user.id,
      group_id: null,
      // A personal expense is always paid by its owner (specification 45); the
      // database enforces this too.
      paid_by: user.id,
      category_id: categoryId,
      item_name: input.itemName,
      amount: input.amount,
      currency_code: DEFAULT_CURRENCY_CODE,
      expense_date: input.expenseDate,
      payment_mode: input.paymentMode,
      notes: input.notes,
    });

    if (error) {
      return {
        status: "error",
        message: writeFailureMessage(error.code, error.message),
        values: raw,
      };
    }
  } catch (error) {
    if (error instanceof CategoryError) {
      return { status: "error", message: error.message, values: raw };
    }

    return {
      status: "error",
      message: unexpectedErrorMessage(error, "expenses:create"),
      values: raw,
    };
  }

  revalidatePath(EXPENSES_PATH);
  revalidatePath(DASHBOARD_PATH);
  // redirect() throws to unwind, so it must sit outside the try block.
  redirect(withFlash(EXPENSES_PATH, "expense-created"));
}

export async function updateExpense(
  id: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const raw = readForm(formData);
  const parsed = expenseSchema.safeParse(raw);

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
    const categoryId = await resolveCategoryId(supabase, user.id, input.category);

    const { data, error } = await supabase
      .from("expenses")
      .update({
        category_id: categoryId,
        item_name: input.itemName,
        amount: input.amount,
        expense_date: input.expenseDate,
        payment_mode: input.paymentMode,
        notes: input.notes,
      })
      .eq("id", id)
      // Scoped to this user's personal rows, so neither another user's expense
      // nor one of their own group expenses can be edited through this form.
      .eq("user_id", user.id)
      .is("group_id", null)
      .select("id");

    if (error) {
      return {
        status: "error",
        message: writeFailureMessage(error.code, error.message),
        values: raw,
      };
    }

    if (!data || data.length === 0) {
      return {
        status: "error",
        message: "That expense no longer exists.",
        values: raw,
      };
    }
  } catch (error) {
    if (error instanceof CategoryError) {
      return { status: "error", message: error.message, values: raw };
    }

    return {
      status: "error",
      message: unexpectedErrorMessage(error, "expenses:update"),
      values: raw,
    };
  }

  revalidatePath(EXPENSES_PATH);
  revalidatePath(DASHBOARD_PATH);
  redirect(withFlash(EXPENSES_PATH, "expense-updated"));
}

export async function deleteExpense(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = String(formData.get("id") ?? "");

  if (!id) {
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
      .eq("id", id)
      .eq("user_id", user.id)
      .is("group_id", null)
      .select("id");

    if (error) {
      return {
        status: "error",
        message: writeFailureMessage(error.code, error.message),
      };
    }

    if (!data || data.length === 0) {
      return { status: "error", message: "That expense no longer exists." };
    }
  } catch (error) {
    return {
      status: "error",
      message: unexpectedErrorMessage(error, "expenses:delete"),
    };
  }

  revalidatePath(EXPENSES_PATH);
  revalidatePath(DASHBOARD_PATH);
  redirect(withFlash(EXPENSES_PATH, "expense-deleted"));
}
