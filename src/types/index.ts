/**
 * Shared value types.
 *
 * This module holds the fixed vocabularies the application is built on
 * (currencies, payment modes, roles) and re-exports the entity types, which are
 * derived from the database schema rather than written twice.
 */

import type { GROUP_ROLES, PAYMENT_MODES } from "@/lib/constants";

/** ISO 4217 code. Symbols are for display only, never the stored value. */
export type CurrencyCode = "INR" | "USD" | "EUR" | "GBP";

export type Currency = {
  code: CurrencyCode;
  symbol: string;
  label: string;
  /** BCP 47 locale used to format amounts in this currency. */
  locale: string;
};

export type PaymentMode = (typeof PAYMENT_MODES)[number]["value"];

/** Permission model is role-based so further roles can be added later. */
export type GroupRole = (typeof GROUP_ROLES)[number];

/** Selection of a calendar month, used for all monthly views. */
export type MonthKey = {
  /** Four-digit year, e.g. 2026. */
  year: number;
  /** 1-12, not zero-based. */
  month: number;
};

/**
 * Entity types, re-exported so application code has one import surface.
 * Their single source of truth is `src/types/database.ts`, which mirrors
 * `supabase/migrations/`.
 */
export type {
  Budget,
  Category,
  Expense,
  Group,
  GroupInvitation,
  GroupMember,
  InvitationStatus,
  Profile,
} from "./database";
