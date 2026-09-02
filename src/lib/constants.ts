import type { Currency, CurrencyCode } from "@/types";

/** Currencies a group can be created in. Stored as the ISO code, never a symbol. */
export const CURRENCIES = [
  { code: "INR", symbol: "₹", label: "Indian Rupee", locale: "en-IN" },
  { code: "USD", symbol: "$", label: "US Dollar", locale: "en-US" },
  { code: "EUR", symbol: "€", label: "Euro", locale: "de-DE" },
  { code: "GBP", symbol: "£", label: "British Pound", locale: "en-GB" },
] as const satisfies readonly Currency[];

export const DEFAULT_CURRENCY_CODE: CurrencyCode = "INR";

export const PAYMENT_MODES = [
  { value: "upi", label: "UPI" },
  { value: "credit_card", label: "Credit Card" },
  { value: "debit_card", label: "Debit Card" },
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "net_banking", label: "Net Banking" },
  { value: "wallet", label: "Wallet" },
  { value: "other", label: "Other" },
] as const;

/** Suggested categories offered when setting up a personal area or a group. */
export const DEFAULT_CATEGORIES = [
  "Food",
  "Groceries",
  "Transportation",
  "Shopping",
  "Bills & Utilities",
  "Entertainment",
  "Healthcare",
  "Travel",
  "Education",
  "Rent",
  "Insurance",
  "Subscriptions",
  "Personal Care",
  "Other",
] as const;

export const GROUP_ROLES = ["admin", "member"] as const;

export const APP_NAME = "Spendora";
export const APP_DESCRIPTION =
  "Track personal and shared monthly expenses, budgets and spending trends.";
