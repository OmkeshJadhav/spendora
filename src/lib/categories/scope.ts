import "server-only";

import { getUser } from "@/lib/auth/dal";
import type { CategoryOwner } from "@/lib/categories/owner";
import type { FormState } from "@/lib/auth/form-state";

/**
 * Turning "which categories?" into an owner, for the mutations.
 *
 * Every category and budget action is bound to a `groupId` by the Server
 * Component that renders its form: a string for a group's categories, `null`
 * for the signed-in user's own. Next encrypts bound arguments, so that value
 * is not something a browser can rewrite — but even if it were, it only says
 * *which* set of categories, never that the caller may change them. RLS
 * answers that: `categories_insert_owner_or_admin` and its siblings require
 * the session's user to be an admin of the group, or the owner of a personal
 * row.
 */

export const SESSION_EXPIRED: FormState = {
  status: "error",
  message: "Your session has expired. Please sign in again.",
};

/** The owner to act on, or null when there is no session left. */
export async function resolveOwner(
  groupId: string | null,
): Promise<CategoryOwner | null> {
  if (groupId) {
    return { kind: "group", groupId };
  }

  const user = await getUser();

  return user ? { kind: "personal", userId: user.id } : null;
}

/**
 * Maps a database rejection to copy a user can act on.
 *
 * `42501` is RLS refusing the write, which here always means the same thing:
 * only a group's admin manages its categories and budgets (specification
 * sections 9 and 14).
 */
export function writeFailureMessage(
  context: string,
  code: string | undefined,
  message: string,
): string {
  console.error(`[${context}]`, { code, message });

  switch (code) {
    case "42501":
      return "You don't have permission to do that. Only a group admin can manage categories and budgets.";
    case "23505":
      return "A category with that name already exists here.";
    case "23503":
      return "That category is no longer available. Refresh and try again.";
    case "23514":
      return "Those details were rejected. Please check them and try again.";
    default:
      return "We couldn't save that change. Please try again.";
  }
}
