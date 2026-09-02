/**
 * Shared value types.
 *
 * These are the fixed vocabularies the application is built on (currencies,
 * payment modes, roles). Entity types for profiles, groups, expenses and so on
 * are derived from the database schema in a later phase, so they are not
 * hand-written here.
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
