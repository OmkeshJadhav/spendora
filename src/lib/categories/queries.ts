import "server-only";

import { ownerColumn, type CategoryOwner } from "@/lib/categories/owner";
import { createClient } from "@/lib/supabase/server";
import type { Category } from "@/types";

/**
 * Reads of a personal area's or a group's categories.
 *
 * One implementation for both: they are the same table, distinguished by which
 * owning column is set (see `CategoryOwner`). RLS decides who may read them —
 * a personal category only its owner, a group's any of its members.
 */

export type CategorySummary = Pick<Category, "id" | "name" | "is_archived">;

/** Active categories first, then archived; alphabetical within each. */
export async function listOwnerCategories(
  owner: CategoryOwner,
): Promise<CategorySummary[]> {
  const supabase = await createClient();
  const { column, value } = ownerColumn(owner);

  const { data, error } = await supabase
    .from("categories")
    .select("id, name, is_archived")
    .eq(column, value)
    .order("is_archived", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    // Detail stays server-side; the error boundary shows friendly copy.
    console.error("[categories:list]", error.message);
    throw new Error("We couldn't load your categories. Please try again.");
  }

  return data ?? [];
}

/**
 * The suggested default names this owner has not taken yet.
 *
 * Matched on `lower(btrim(name))`, the same way the unique index does, so a
 * name the database would reject as a duplicate is never offered.
 */
export function unusedDefaults(
  categories: readonly CategorySummary[],
  defaults: readonly string[],
): string[] {
  const taken = new Set(
    categories.map((category) => category.name.trim().toLowerCase()),
  );

  return defaults.filter((name) => !taken.has(name.trim().toLowerCase()));
}
