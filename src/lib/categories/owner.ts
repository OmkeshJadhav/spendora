/**
 * Who a category or a budget belongs to.
 *
 * `categories` and `budgets` each carry exactly one owner — `user_id` for a
 * personal row, `group_id` for a group one, enforced by a check constraint.
 * Every read and write in this area is the same query against a different
 * column, so the column is a parameter rather than a copied function.
 *
 * A `personal` owner's `userId` always comes from the session. A `group`
 * owner's `groupId` comes from the URL, which says *which* group and nothing
 * about the right to act on it — that is RLS's answer, not this type's.
 */
export type CategoryOwner =
  | { kind: "personal"; userId: string }
  | { kind: "group"; groupId: string };

/** The owning column and its value, for a `.eq()` on either table. */
export function ownerColumn(owner: CategoryOwner): {
  column: "user_id" | "group_id";
  value: string;
} {
  return owner.kind === "personal"
    ? { column: "user_id", value: owner.userId }
    : { column: "group_id", value: owner.groupId };
}

/** The insert payload that sets the owner, leaving the other column null. */
export function ownerColumns(owner: CategoryOwner): {
  user_id: string | null;
  group_id: string | null;
} {
  return owner.kind === "personal"
    ? { user_id: owner.userId, group_id: null }
    : { user_id: null, group_id: owner.groupId };
}

/** Where this owner's categories are managed. */
export function categoriesPath(owner: CategoryOwner): string {
  return owner.kind === "personal"
    ? "/categories"
    : `/groups/${owner.groupId}/categories`;
}
