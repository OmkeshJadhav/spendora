/**
 * One-shot messages carried across a redirect.
 *
 * A Server Action that redirects cannot also return a message for
 * `useActionState` — the component it would have rendered into is gone. The
 * action appends `?flash=…` instead, and the destination toasts it once and
 * strips it from the URL so a refresh does not repeat it.
 */

export const FLASH_MESSAGES = {
  "expense-created": "Expense added.",
  "expense-updated": "Expense updated.",
  "expense-deleted": "Expense deleted.",
  "group-created": "Group created.",
  "group-updated": "Group details saved.",
  "group-deleted": "Group deleted.",
  "group-left": "You've left the group.",
  "member-removed": "Member removed.",
  "member-role-updated": "Role updated.",
  "invitation-revoked": "Invitation revoked.",
  "invitation-declined": "Invitation declined.",
  "invitation-dismissed": "Invitation removed.",
  "invitation-accepted": "You've joined the group.",
  "already-a-member": "You're already a member of this group.",
} as const;

export type FlashKey = keyof typeof FLASH_MESSAGES;

export function flashMessage(key: string | undefined): string | null {
  if (!key) {
    return null;
  }

  return key in FLASH_MESSAGES ? FLASH_MESSAGES[key as FlashKey] : null;
}

/** Builds a destination carrying a flash message. */
export function withFlash(path: string, key: FlashKey): string {
  return `${path}?flash=${key}`;
}
