import { formatMonthLabel } from "@/lib/dates";
import {
  dateBounds,
  monthScope,
  type ExpenseFilters,
} from "@/lib/expenses/filters";
import type { EXPORT_FORMATS } from "@/lib/export/format";

/**
 * Naming the downloaded file (specification §25).
 *
 * §25's example is `goa-trip-september-2026-expenses.csv`, and the shape it
 * implies is worth stating: **what** the expenses are, **when** they are from,
 * then what the file is. A folder of these sorts sensibly and each one says
 * what it holds without being opened — which is the entire job of a filename
 * on something a person downloads once a month.
 *
 * The result is restricted to `[a-z0-9-]` and a single dot. That is a
 * convenience for the reader — no spaces to quote, nothing a filesystem will
 * object to — and it also happens to close the header-injection question:
 * there is no quote, newline or semicolon left to break out of the
 * `Content-Disposition` value with, so the header cannot be forged through a
 * group name.
 */

/** Long enough to stay recognisable, short enough to leave room for the rest. */
const MAX_SCOPE_LENGTH = 60;

/**
 * A name as a URL-style slug.
 *
 * Accents are decomposed and their marks dropped, so "Café" becomes "cafe"
 * rather than "caf". A name written entirely in a script with no ASCII form
 * slugs to nothing, which is what `fallback` is for.
 */
export function slugify(value: string, fallback: string): string {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SCOPE_LENGTH)
    .replace(/-+$/g, "");

  return slug.length > 0 ? slug : fallback;
}

/**
 * The "when" part of the name, from whichever control set the scope.
 *
 * It reads back the same distinction the scope navigator shows on screen, so
 * the file a person downloads is named after the view they downloaded it from
 * rather than after the query that produced it.
 */
function periodSlug(filters: ExpenseFilters): string {
  const month = monthScope(filters);

  if (month) {
    // "September 2026" -> "september-2026", the form §25's example uses.
    return slugify(formatMonthLabel(month), "month");
  }

  const { start, end } = dateBounds(filters);

  if (start && end) {
    return `${start}-to-${end}`;
  }

  if (start) {
    return `from-${start}`;
  }

  if (end) {
    return `up-to-${end}`;
  }

  return "all-time";
}

/**
 * `goa-trip-september-2026-expenses.csv`.
 *
 * `scope` is the group's name, or "personal" for a private list — the word a
 * person would use for the list they are looking at.
 */
export function exportFilename({
  scope,
  filters,
  extension,
}: {
  scope: string;
  filters: ExpenseFilters;
  extension: (typeof EXPORT_FORMATS)[keyof typeof EXPORT_FORMATS]["extension"];
}): string {
  return `${slugify(scope, "expenses")}-${periodSlug(filters)}-expenses.${extension}`;
}

/**
 * The workbook's sheet name and the human title of the export, e.g.
 * "Goa Trip 2026 — September 2026".
 *
 * Kept beside the filename because it answers the same two questions, and the
 * two should never disagree about the period they name.
 */
export function exportTitle(scope: string, filters: ExpenseFilters): string {
  const month = monthScope(filters);

  return month ? `${scope} ${formatMonthLabel(month)}` : scope;
}
