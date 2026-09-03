import { z } from "zod";

/**
 * Category input schemas (specification sections 13, 14 and 43).
 *
 * The same schemas run in the browser for fast feedback and again on the
 * server, which never trusts the client's checks. The length bound mirrors
 * `categories_name_length` exactly, so a name that passes here cannot be
 * rejected by Postgres for a reason the user was never shown.
 */

const name = z
  .string()
  .trim()
  .min(1, "Category name is required")
  .max(60, "Category name must be 60 characters or fewer");

const categoryId = z.uuid("That category could not be found");

export const createCategorySchema = z.object({ name });

export const renameCategorySchema = z.object({ categoryId, name });

export const categoryIdSchema = z.object({ categoryId });

/**
 * Adding several suggested defaults at once.
 *
 * The names are checked against the suggestion list itself in the action, not
 * here: this schema only establishes that some were sent and that none is
 * longer than the column allows.
 */
export const addDefaultsSchema = z.object({
  names: z.array(name).min(1, "Choose at least one category").max(50),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type RenameCategoryInput = z.infer<typeof renameCategorySchema>;
