import { EXPORT_COLUMNS, type ExportRow } from "@/lib/export/rows";

/**
 * The CSV writer (specification §25).
 *
 * RFC 4180: comma-separated, CRLF line endings, and a field quoted only when
 * it contains a comma, a quote or a newline. Kept pure — rows in, string out —
 * so it can be reasoned about and tested without a database or a request.
 *
 * A CSV is a data file, so values are written in the machine-readable form of
 * themselves rather than the form the screen shows. Dates are ISO 8601, which
 * sorts as text and is the one date format a spreadsheet parses the same way
 * in every locale; amounts are plain decimals with a dot and no grouping,
 * because "₹2,450.00" in a numeric column is a picture of a number. The
 * currency is not lost by that — §25 gives it a column of its own, and the
 * Excel export (`xlsx.ts`) is where a formatted amount is possible without
 * destroying the value underneath it.
 */

/**
 * A UTF-8 byte-order mark, prepended to every file.
 *
 * Excel on Windows reads a BOM-less CSV in the system's legacy code page, which
 * turns any non-ASCII item name or note into mojibake on open. Three bytes fix
 * it, and every other consumer of CSV skips them.
 */
export const CSV_BOM = "\uFEFF";

const DELIMITER = ",";
const NEWLINE = "\r\n";

/**
 * Characters that make a spreadsheet treat a cell as a formula rather than as
 * text — the CSV injection problem.
 *
 * This matters here specifically because expenses are *shared*: a group member
 * chooses their own item names and notes, and an admin is the one who opens
 * the export. A note beginning `=` is a cell Excel would evaluate in somebody
 * else's spreadsheet, and formulas can reach outside the file.
 */
const FORMULA_LEADS = ["=", "+", "-", "@", "\t", "\r"];

/**
 * Neutralises a value that would otherwise be read as a formula.
 *
 * A leading apostrophe is the conventional fix: Excel and LibreOffice both
 * treat the rest of the cell as literal text and do not display the quote. It
 * is applied only to text columns — an amount is written by this module, never
 * by a user, and prefixing it would break the number it is meant to be.
 */
function neutralise(value: string): string {
  return FORMULA_LEADS.some((lead) => value.startsWith(lead))
    ? `'${value}`
    : value;
}

/** Quotes a field only when it must be, doubling any quotes inside it. */
function escape(value: string): string {
  return /[",\r\n]/.test(value)
    ? `"${value.replaceAll('"', '""')}"`
    : value;
}

function cell(row: ExportRow, column: (typeof EXPORT_COLUMNS)[number]): string {
  const value = row[column.key];

  switch (column.kind) {
    case "amount":
      // Two decimals always, matching numeric(14,2). No grouping separator:
      // a thousands comma inside a comma-separated file is asking for it.
      return Number(value).toFixed(2);
    case "date":
      // Already `YYYY-MM-DD`, which is the form to write it in.
      return String(value);
    case "timestamp":
      // Already normalised to UTC ISO 8601 by `buildExportRows`, so that this
      // and the spreadsheet cannot disagree about it.
      return String(value);
    default:
      return neutralise(String(value));
  }
}

/** The header row plus one line per expense, ready to be served as a file. */
export function toCsv(rows: readonly ExportRow[]): string {
  const header = EXPORT_COLUMNS.map((column) => escape(column.header));

  const lines = rows.map((row) =>
    EXPORT_COLUMNS.map((column) => escape(cell(row, column))).join(DELIMITER),
  );

  // A trailing newline: a text file's last line ends, like every other line.
  return (
    CSV_BOM + [header.join(DELIMITER), ...lines].join(NEWLINE) + NEWLINE
  );
}
