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
import { DEFAULT_CATEGORIES } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import {
  addDefaultsSchema,
  categoryIdSchema,
  createCategorySchema,
  renameCategorySchema,
} from "@/lib/validations/category";

/**
 * Category management (specification sections 13 and 14).
 *
 * Each action is bound to a `groupId` — `null` for the signed-in user's own
 * categories — by the Server Component that renders its form, re-validates its
 * input, and re-derives the user from the session. What it may then do is the
 * database's decision: a personal category belongs to its owner, and a group's
 * categories are admin-managed, which is what `categories_insert_owner_or_admin`
 * and its siblings enforce. Nothing here re-implements that check; the messages
 * only explain a refusal.
 *
 * Two operations exist for "I don't need this any more", because they are
 * genuinely different:
 *
 *   - Archiving keeps the category, so historical expenses still name it, and
 *     stops it being offered for new ones (`expenses_check_category_active`).
 *   - Deleting removes it. Its expenses are not deleted — a trigger detaches
 *     them first, so they survive as uncategorised — and its budget goes with
 *     it through the composite foreign key's cascade.
 */

function refresh(owner: CategoryOwner): void {
  revalidatePath(categoriesPath(owner));

  if (owner.kind === "personal") {
    revalidatePath("/dashboard");
    revalidatePath("/expenses");
  } else {
    revalidatePath(`/groups/${owner.groupId}`);
    revalidatePath(`/groups/${owner.groupId}/expenses`);
  }
}

/** The first message from a failed parse — these forms are one field each. */
function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Please check the details and try again.";
}

export async function createCategory(
  groupId: string | null,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const raw = { name: String(formData.get("name") ?? "") };
  const parsed = createCategorySchema.safeParse(raw);

  if (!parsed.success) {
    return {
      status: "error",
      message: firstIssue(parsed.error),
      fieldErrors: { name: [firstIssue(parsed.error)] },
      values: raw,
    };
  }

  try {
    const owner = await resolveOwner(groupId);

    if (!owner) {
      return SESSION_EXPIRED;
    }

    const supabase = await createClient();

    const { error } = await supabase
      .from("categories")
      .insert({ ...ownerColumns(owner), name: parsed.data.name });

    if (error) {
      return {
        status: "error",
        message: writeFailureMessage("categories:create", error.code, error.message),
        values: raw,
      };
    }

    refresh(owner);

    return { status: "success", message: `“${parsed.data.name}” added.` };
  } catch (error) {
    return {
      status: "error",
      message: unexpectedErrorMessage(error, "categories:create"),
      values: raw,
    };
  }
}

/**
 * Adds several suggested categories at once.
 *
 * Names are matched against `DEFAULT_CATEGORIES` rather than taken as sent:
 * this form only ever offers suggestions, so anything else in it is a tampered
 * request, and `createCategory` is the way to add a name of your own.
 */
export async function addDefaultCategories(
  groupId: string | null,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const requested = formData.getAll("names").map((value) => String(value));
  const allowed = new Set<string>(DEFAULT_CATEGORIES);
  const names = [...new Set(requested.filter((name) => allowed.has(name)))];

  const parsed = addDefaultsSchema.safeParse({ names });

  if (!parsed.success) {
    return { status: "error", message: "Choose at least one category to add." };
  }

  try {
    const owner = await resolveOwner(groupId);

    if (!owner) {
      return SESSION_EXPIRED;
    }

    const supabase = await createClient();
    const columns = ownerColumns(owner);

    const { error } = await supabase
      .from("categories")
      .insert(parsed.data.names.map((name) => ({ ...columns, name })));

    if (error) {
      // 23505 here means one of the names was added between the page
      // rendering and the form being submitted. The insert is all-or-nothing,
      // so say so rather than half-applying it.
      if (error.code === "23505") {
        return {
          status: "error",
          message: "Some of those already exist. Refresh and try again.",
        };
      }

      return {
        status: "error",
        message: writeFailureMessage("categories:addDefaults", error.code, error.message),
      };
    }

    refresh(owner);

    return {
      status: "success",
      message:
        parsed.data.names.length === 1
          ? `“${parsed.data.names[0]}” added.`
          : `${parsed.data.names.length} categories added.`,
    };
  } catch (error) {
    return {
      status: "error",
      message: unexpectedErrorMessage(error, "categories:addDefaults"),
    };
  }
}

/**
 * Renames a category.
 *
 * Returns a message rather than redirecting, as every other control on this
 * page does: the row it belongs to is revalidated in place, so the new name
 * appears without the page navigating and without the form losing what was
 * typed when a name is refused.
 */
export async function renameCategory(
  groupId: string | null,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const raw = {
    categoryId: String(formData.get("categoryId") ?? ""),
    name: String(formData.get("name") ?? ""),
  };
  const parsed = renameCategorySchema.safeParse(raw);

  if (!parsed.success) {
    return {
      status: "error",
      message: firstIssue(parsed.error),
      fieldErrors: { name: [firstIssue(parsed.error)] },
      values: raw,
    };
  }

  try {
    const owner = await resolveOwner(groupId);

    if (!owner) {
      return SESSION_EXPIRED;
    }

    const supabase = await createClient();
    const { column, value } = ownerColumn(owner);

    const { data, error } = await supabase
      .from("categories")
      .update({ name: parsed.data.name })
      .eq("id", parsed.data.categoryId)
      // Scoped to this owner, so an id belonging to another group — or to
      // somebody's personal categories — matches nothing rather than being
      // renamed. RLS refuses it as well.
      .eq(column, value)
      .select("id");

    if (error) {
      return {
        status: "error",
        message: writeFailureMessage("categories:rename", error.code, error.message),
        values: raw,
      };
    }

    if (!data || data.length === 0) {
      return { status: "error", message: "That category no longer exists.", values: raw };
    }

    refresh(owner);

    return { status: "success", message: `Renamed to “${parsed.data.name}”.` };
  } catch (error) {
    return {
      status: "error",
      message: unexpectedErrorMessage(error, "categories:rename"),
      values: raw,
    };
  }
}

/** Archiving and restoring differ only in the value they write. */
async function setArchived(
  groupId: string | null,
  archived: boolean,
  formData: FormData,
): Promise<FormState> {
  const parsed = categoryIdSchema.safeParse({
    categoryId: String(formData.get("categoryId") ?? ""),
  });

  if (!parsed.success) {
    return { status: "error", message: "That category no longer exists." };
  }

  try {
    const owner = await resolveOwner(groupId);

    if (!owner) {
      return SESSION_EXPIRED;
    }

    const supabase = await createClient();
    const { column, value } = ownerColumn(owner);

    const { data, error } = await supabase
      .from("categories")
      .update({ is_archived: archived })
      .eq("id", parsed.data.categoryId)
      .eq(column, value)
      .select("id");

    if (error) {
      return {
        status: "error",
        message: writeFailureMessage("categories:archive", error.code, error.message),
      };
    }

    if (!data || data.length === 0) {
      return { status: "error", message: "That category no longer exists." };
    }

    refresh(owner);

    return {
      status: "success",
      message: archived
        ? "Category archived. Existing expenses keep it."
        : "Category restored.",
    };
  } catch (error) {
    return {
      status: "error",
      message: unexpectedErrorMessage(error, "categories:archive"),
    };
  }
}

export async function archiveCategory(
  groupId: string | null,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  return setArchived(groupId, true, formData);
}

export async function restoreCategory(
  groupId: string | null,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  return setArchived(groupId, false, formData);
}

export async function deleteCategory(
  groupId: string | null,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = categoryIdSchema.safeParse({
    categoryId: String(formData.get("categoryId") ?? ""),
  });

  if (!parsed.success) {
    return { status: "error", message: "That category no longer exists." };
  }

  try {
    const owner = await resolveOwner(groupId);

    if (!owner) {
      return SESSION_EXPIRED;
    }

    const supabase = await createClient();
    const { column, value } = ownerColumn(owner);

    const { data, error } = await supabase
      .from("categories")
      .delete()
      .eq("id", parsed.data.categoryId)
      .eq(column, value)
      .select("id");

    if (error) {
      return {
        status: "error",
        message: writeFailureMessage("categories:delete", error.code, error.message),
      };
    }

    if (!data || data.length === 0) {
      return { status: "error", message: "That category no longer exists." };
    }

    refresh(owner);

    return {
      status: "success",
      message: "Category deleted. Its expenses are now uncategorised.",
    };
  } catch (error) {
    return {
      status: "error",
      message: unexpectedErrorMessage(error, "categories:delete"),
    };
  }
}
