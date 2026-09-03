import { z } from "zod";

import { CURRENCIES, GROUP_ROLES } from "@/lib/constants";
import type { CurrencyCode, GroupRole } from "@/types";

/**
 * Group, membership and invitation input schemas (specification section 43).
 *
 * The same schemas run in the browser for fast feedback and again on the
 * server, which never trusts the client's checks. Lengths mirror the database
 * constraints exactly, so a value that passes here cannot be rejected by
 * Postgres for a reason the user was never shown.
 */

const currencyCodes = CURRENCIES.map((currency) => currency.code);

const name = z
  .string()
  .trim()
  .min(1, "Group name is required")
  .max(80, "Group name must be 80 characters or fewer");

const description = z
  .string()
  .trim()
  .max(500, "Description must be 500 characters or fewer")
  .transform((value) => (value === "" ? null : value));

const currencyCode = z
  .string()
  .trim()
  .refine(
    (value): value is CurrencyCode => currencyCodes.includes(value as CurrencyCode),
    "Choose a currency from the list",
  )
  .transform((value) => value as CurrencyCode);

const role = z
  .string()
  .trim()
  .refine(
    (value): value is GroupRole => (GROUP_ROLES as readonly string[]).includes(value),
    "Choose a role from the list",
  )
  .transform((value) => value as GroupRole);

const email = z
  .string()
  .trim()
  .min(1, "Email is required")
  .pipe(z.email("Enter a valid email address"))
  // The database normalises this too; doing it here means the duplicate check
  // and the message the user sees agree with what is stored.
  .transform((value) => value.toLowerCase());

/** Creating a group: the currency is chosen up front (specification 10). */
export const createGroupSchema = z.object({
  name,
  description,
  currencyCode,
});

/** Editing a group. Currency is included: it is editable until the first expense. */
export const updateGroupSchema = z.object({
  name,
  description,
  currencyCode,
});

export const inviteMemberSchema = z.object({
  email,
  role,
});

export const memberRoleSchema = z.object({
  memberId: z.uuid("That member could not be found"),
  role,
});

export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type MemberRoleInput = z.infer<typeof memberRoleSchema>;
