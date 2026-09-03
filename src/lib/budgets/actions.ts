"use server";

import { revalidatePath } from "next/cache";

import { unexpectedErrorMessage } from "@/lib/auth/errors";
import type { FormState } from "@/lib/auth/form-state";
import {
  categoriesPath,
  ownerColumn,
  ownerColumns,
  type CategoryOwner,
} from "@/lib/categories/owner";
import {
  resolveOwner,
  SESSION_EXPIRED,
  writeFailureMessage,
} from "@/lib/categories/scope";
import { createClient } from "@/lib/supabase/server";
import { clearBudgetSchema, setBudgetSchema } from "@/lib/validations/budget";

/**
 * Budget mutations (specification section 15).
 *
 * These write the *standing* monthly budget — the row with `period_month`
 * NULL, which applies to every month until a month-specific row overrides it.
 * Reading already honours both (see `lib/budgets/queries`), so month-specific
 * budgets are a UI away rather than a migration away.
 *
 * As everywhere else, the group id is bound by the Server Component and says
 * only *which* budgets. Whether the caller may set them is the database's
 * answer: `budgets_insert_owner_or_admin` and its siblings require an admin of
 * that group, and the composite foreign keys refuse a budget whose category
 * belongs to somebody else — so a crafted request cannot budget another user's
 * category even with a valid session.
 */

function refresh(owner: CategoryOwner): void {
  revalidatePath(categoriesPath(owner));

  if (owner.kind === "personal") {
    revalidatePath("/dashboard");
  } else {
    revalidatePath(`/groups/${owner.groupId}`);
  }
}

/** The standing budget row for a category, or null. */
async function findStandingBudget(
  owner: CategoryOwner,
  categoryId: string,
): Promise<{ id: string } | null> {
  const supabase = await createClient();
  const { column, value } = ownerColumn(owner);

  const { data, error } = await supabase
    .from("budgets")
    .select("id")
    .eq("category_id", categoryId)
    .eq(column, value)
    .is("period_month", null)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

/**
 * Sets or replaces a category's monthly budget.
 *
 * Read-then-write rather than an upsert: the uniqueness that makes "one
 * standing budget per category" true is a *partial* unique index
 * (`budgets_standing_unique_idx ... where period_month is null`), and
 * PostgREST's `on_conflict` takes column names only — it cannot express the
 * predicate, so the inference would fail. The race that leaves is a duplicate
 * insert, which the index still refuses; that refusal is caught below and
 * retried as an update, so the last writer wins rather than the user seeing an
 * error they cannot act on.
 */
export async function setBudget(
  groupId: string | null,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const raw = {
    categoryId: String(formData.get("categoryId") ?? ""),
    amount: String(formData.get("amount") ?? ""),
  };
  const parsed = setBudgetSchema.safeParse(raw);

  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message ?? "Please check the amount and try again.";

    return {
      status: "error",
      message,
      fieldErrors: { amount: [message] },
      values: raw,
    };
  }

  try {
    const owner = await resolveOwner(groupId);

    if (!owner) {
      return SESSION_EXPIRED;
    }

    const supabase = await createClient();
    const { categoryId, amount } = parsed.data;
    const existing = await findStandingBudget(owner, categoryId);

    if (existing) {
      const { data, error } = await supabase
        .from("budgets")
        .update({ amount })
        .eq("id", existing.id)
        .select("id");

      if (error) {
        return {
          status: "error",
          message: writeFailureMessage("budgets:update", error.code, error.message),
          values: raw,
        };
      }

      if (!data || data.length === 0) {
        return { status: "error", message: "That budget no longer exists.", values: raw };
      }
    } else {
      const { error } = await supabase.from("budgets").insert({
        ...ownerColumns(owner),
        category_id: categoryId,
        amount,
        period_month: null,
      });

      if (error) {
        // Somebody set this budget between the read and the insert. Theirs is
        // in place; this request is the newer intent, so apply it as an update.
        if (error.code === "23505") {
          const raced = await findStandingBudget(owner, categoryId);

          if (raced) {
            const { error: updateError } = await supabase
              .from("budgets")
              .update({ amount })
              .eq("id", raced.id);

            if (updateError) {
              return {
                status: "error",
                message: writeFailureMessage(
                  "budgets:updateAfterRace",
                  updateError.code,
                  updateError.message,
                ),
                values: raw,
              };
            }
          }
        } else {
          return {
            status: "error",
            message: writeFailureMessage("budgets:insert", error.code, error.message),
            values: raw,
          };
        }
      }
    }

    refresh(owner);

    return { status: "success", message: "Budget saved." };
  } catch (error) {
    return {
      status: "error",
      message: unexpectedErrorMessage(error, "budgets:set"),
      values: raw,
    };
  }
}

/**
 * Removes a category's monthly budget.
 *
 * Deleting rather than storing zero: `budgets_amount_positive` refuses zero,
 * and "no budget" and "a budget of nothing" should not be the same row anyway
 * — the first is untracked, the second would be permanently over budget.
 */
export async function clearBudget(
  groupId: string | null,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = clearBudgetSchema.safeParse({
    categoryId: String(formData.get("categoryId") ?? ""),
  });

  if (!parsed.success) {
    return { status: "error", message: "That budget no longer exists." };
  }

  try {
    const owner = await resolveOwner(groupId);

    if (!owner) {
      return SESSION_EXPIRED;
    }

    const supabase = await createClient();
    const { column, value } = ownerColumn(owner);

    const { data, error } = await supabase
      .from("budgets")
      .delete()
      .eq("category_id", parsed.data.categoryId)
      .eq(column, value)
      .is("period_month", null)
      .select("id");

    if (error) {
      return {
        status: "error",
        message: writeFailureMessage("budgets:clear", error.code, error.message),
      };
    }

    if (!data || data.length === 0) {
      return { status: "error", message: "That budget no longer exists." };
    }

    refresh(owner);

    return { status: "success", message: "Budget removed." };
  } catch (error) {
    return {
      status: "error",
      message: unexpectedErrorMessage(error, "budgets:clear"),
    };
  }
}
