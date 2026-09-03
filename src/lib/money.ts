import { CURRENCIES, DEFAULT_CURRENCY_CODE } from "@/lib/constants";
import type { CurrencyCode } from "@/types";

/**
 * Money handling.
 *
 * Amounts are stored as `numeric(14,2)` and arrive from PostgREST as JSON
 * numbers, which is exact at that scale. Adding doubles repeatedly is not
 * (0.1 + 0.2 ≠ 0.3), so every total here is accumulated in integer minor units
 * — paise, cents — and converted back only to format. Aggregates over large
 * sets still belong in SQL; these helpers serve one user's month.
 */

/** The largest amount `numeric(14,2)` can hold, in minor units. */
const MAX_MINOR_UNITS = 99_999_999_999_999;

/** Rupees to paise. Rounds, because a stored value never has more than 2 dp. */
export function toMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}

export function fromMinorUnits(minor: number): number {
  return minor / 100;
}

/** Exact total of stored amounts. */
export function sumAmounts(amounts: readonly number[]): number {
  return amounts.reduce<number>((total, amount) => total + toMinorUnits(amount), 0);
}

export function currencyOf(code: CurrencyCode) {
  return (
    CURRENCIES.find((currency) => currency.code === code) ??
    CURRENCIES.find((currency) => currency.code === DEFAULT_CURRENCY_CODE)!
  );
}

/** "₹2,450.00" — formatted in the currency's own locale. */
export function formatCurrency(
  amount: number,
  code: CurrencyCode = DEFAULT_CURRENCY_CODE,
): string {
  const currency = currencyOf(code);

  return new Intl.NumberFormat(currency.locale, {
    style: "currency",
    currency: currency.code,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** As `formatCurrency`, for a total that was accumulated in minor units. */
export function formatMinorUnits(
  minor: number,
  code: CurrencyCode = DEFAULT_CURRENCY_CODE,
): string {
  return formatCurrency(fromMinorUnits(minor), code);
}

/**
 * "₹8.5K" — a total shortened to fit a chart label.
 *
 * Only ever used where the exact figure is also available in text nearby or as
 * the label a screen reader reads: a rounded number is a label, never the
 * answer.
 *
 * `minimumFractionDigits: 0` is not optional. Currency formatting defaults to
 * two decimal places, and a `maximumFractionDigits` below that clamps the
 * *minimum* up to it rather than allowing none — so without it every
 * uncompacted figure gains a trailing zero and reads as "₹150.0", which is not
 * how money is written.
 *
 * Each locale compacts in its own units, which is the point of asking it: an
 * Indian reader gets "₹12.5L" for 1,250,000 rather than a lakh spelled as
 * millions, and German does not abbreviate below a million at all.
 */
export function formatCompactMinorUnits(
  minor: number,
  code: CurrencyCode = DEFAULT_CURRENCY_CODE,
): string {
  const currency = currencyOf(code);

  return new Intl.NumberFormat(currency.locale, {
    style: "currency",
    currency: currency.code,
    notation: "compact",
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  }).format(fromMinorUnits(minor));
}

/** A whole-number percentage share, safe when the total is zero. */
export function percentageOf(part: number, total: number): number {
  if (total <= 0) {
    return 0;
  }

  return Math.round((part / total) * 100);
}

/** Upper bound for user-entered amounts, expressed in major units. */
export const MAX_AMOUNT = fromMinorUnits(MAX_MINOR_UNITS);
