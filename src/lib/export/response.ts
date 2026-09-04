import "server-only";

import { parseExpenseFilters, type ExpenseFilters } from "@/lib/expenses/filters";
import { toCsv } from "@/lib/export/csv";
import { exportFilename, exportTitle } from "@/lib/export/filename";
import {
  EXPORT_FORMATS,
  parseExportFormat,
  type ExportFormat,
} from "@/lib/export/format";
import { EXPORT_MAX_ROWS, type ExportData } from "@/lib/export/queries";
import { toXlsx } from "@/lib/export/xlsx";

/**
 * Turning export data into the HTTP response that downloads it.
 *
 * Shared by the personal and the group route so the two cannot drift apart in
 * how they name a file, what they set on it, or what they say when something
 * is wrong. Each route is then only what it uniquely is: which rows, and who
 * may have them.
 */

/**
 * Reads filters out of a request's query string.
 *
 * `Object.fromEntries` keeps the first value of any repeated parameter, which
 * is the same thing `parseExpenseFilters` does with an array — so an export
 * link and the list it came from read a hand-edited URL identically.
 */
export function filtersFromRequest(url: URL): ExpenseFilters {
  return parseExpenseFilters(Object.fromEntries(url.searchParams));
}

export function formatFromRequest(url: URL): ExportFormat {
  return parseExportFormat(url.searchParams.get("format"));
}

/**
 * The finished download.
 *
 * `no-store` matters more than it looks: an export is somebody's private
 * spending, served over a plain GET whose URL carries the filters. Nothing in
 * the chain between the server and the browser should keep a copy.
 */
export function exportResponse(
  data: ExportData,
  filters: ExpenseFilters,
  format: ExportFormat,
): Response {
  const { contentType, extension } = EXPORT_FORMATS[format];
  const filename = exportFilename({ scope: data.scope, filters, extension });

  const body =
    format === "xlsx"
      ? toXlsx(data.rows, {
          currency: data.currency,
          title: exportTitle(data.scope, filters),
        })
      : toCsv(data.rows);

  return new Response(body as BodyInit, {
    headers: {
      "content-type": contentType,
      // `attachment` is what makes the browser save it rather than render it.
      // The filename is slug-safe by construction, so it needs no quoting
      // beyond this and cannot carry a second header directive.
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}

/**
 * What a person sees when their filters match more rows than one file holds.
 *
 * Plain text and an actionable sentence, because this arrives as a navigation
 * rather than inside the application: the browser is following a download
 * link, so there is no page waiting to receive a toast. §28 asks that an
 * export failure be understandable, and "narrow it to a month" is the thing
 * they can actually do about it.
 */
export function tooLargeResponse(): Response {
  return new Response(
    `This export covers more than ${EXPORT_MAX_ROWS.toLocaleString("en-GB")} expenses, which is more than one file can hold.\n\nNarrow it to a single month or a shorter date range, then download it again.\n`,
    {
      status: 413,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "private, no-store",
      },
    },
  );
}
