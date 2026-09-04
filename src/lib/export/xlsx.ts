import "server-only";

import { currencyOf } from "@/lib/money";
import { createZip, type ZipEntry } from "@/lib/export/zip";
import { EXPORT_COLUMNS, type ExportRow } from "@/lib/export/rows";
import type { CurrencyCode } from "@/types";

/**
 * The Excel writer (specification §25, Phase 10).
 *
 * An `.xlsx` is a ZIP of XML parts — the OOXML SpreadsheetML format. This
 * writes the six parts a single-sheet workbook needs and hands them to
 * `zip.ts`. Nothing here is general-purpose: one sheet, one header row, the
 * nine columns §25 asks for.
 *
 * The point of offering it beside the CSV is types. In a CSV every cell is
 * text, so the amounts cannot be summed and the dates sort alphabetically
 * unless the reader re-imports the file and tells Excel what each column is.
 * Here:
 *
 *   - **Amounts are numbers**, carrying a currency number format. The cell
 *     shows the amount formatted and still adds up, which is what §25's
 *     "correct currency formatting" has to mean in a spreadsheet.
 *   - **Dates are dates**, carrying a `dd mmm yyyy` format, so the column
 *     displays "10 Sep 2026" and sorts chronologically.
 *   - **Created stays text.** It is a `timestamptz`, and a spreadsheet has
 *     nowhere to put a zone: converting it would mean silently choosing one.
 *     An expense's date is a calendar day with no zone, which is exactly why
 *     that column *can* be a real date.
 *
 * Text cells are written inline (`t="inlineStr"`) rather than through a shared
 * strings table. It costs a little size on repeated categories and saves a
 * whole part, an index and a second pass. It also means no user-supplied text
 * is ever evaluated: unlike a CSV, an item name beginning `=` is a string
 * here, because the cell says so.
 */

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const RELS_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const DOC_RELS_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** Style indexes into `cellXfs` below. The order there is this contract. */
const STYLE_DEFAULT = 0;
const STYLE_HEADER = 1;
const STYLE_CURRENCY = 2;
const STYLE_DATE = 3;

/** Custom number formats start at 164; 0-163 are Excel's built-ins. */
const NUMFMT_CURRENCY = 164;
const NUMFMT_DATE = 165;

/**
 * Control characters XML 1.0 forbids outright.
 *
 * Built from a string rather than written as a regular-expression literal so
 * the source file contains no control characters of its own. Tab, newline and
 * carriage return are legal and deliberately outside these ranges — a note may
 * contain a line break. Anything else below 0x20 would make the whole workbook
 * unopenable rather than showing as a stray glyph.
 */
const FORBIDDEN_CONTROL_CHARS = new RegExp(
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]",
  "g",
);

/** Escapes text for XML, dropping what XML cannot carry at all. */
function xml(value: string): string {
  return value
    .replace(FORBIDDEN_CONTROL_CHARS, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** `0 -> A`, `25 -> Z`, `26 -> AA`. Spreadsheet column names are bijective. */
function columnName(index: number): string {
  let name = "";
  let remaining = index;

  while (remaining >= 0) {
    name = String.fromCharCode(65 + (remaining % 26)) + name;
    remaining = Math.floor(remaining / 26) - 1;
  }

  return name;
}

/**
 * The epoch Excel counts days from.
 *
 * 30 December 1899, not the 31st: Excel deliberately reproduces Lotus 1-2-3's
 * belief that 1900 was a leap year, and shifting the epoch back a day is how
 * every date after February 1900 comes out right anyway.
 */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * A `YYYY-MM-DD` as Excel's day number.
 *
 * Computed in UTC throughout — not because the value is UTC, but because it is
 * a calendar day with no zone at all, and UTC arithmetic is the only kind with
 * no daylight-saving jump that could round a day across a boundary.
 */
function serialDate(value: string): number | null {
  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    return null;
  }

  return Math.round(
    (Date.UTC(year, month - 1, day) - EXCEL_EPOCH_UTC) / MILLISECONDS_PER_DAY,
  );
}

/**
 * A currency number format code: the quoted symbol, then `#,##0.00`.
 *
 * The symbol is quoted so a character Excel would otherwise read as a format
 * directive is taken literally. Grouping is the plain three-digit kind in
 * every currency, including INR: Excel's lakh grouping needs a conditional
 * three-part format code, and an unfamiliar group separator is a smaller cost
 * than a format string nobody can maintain.
 */
function currencyFormat(code: CurrencyCode): string {
  const symbol = currencyOf(code).symbol.replaceAll('"', "");

  return `"${symbol}"#,##0.00`;
}

/** Excel rejects these in a sheet name, and caps the name at 31 characters. */
function sheetName(name: string): string {
  const cleaned = name
    .replace(/[\\/?*[\]:]/g, " ")
    .trim()
    .slice(0, 31);

  return cleaned.length > 0 ? cleaned : "Expenses";
}

function contentTypes(): string {
  return `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
}

function packageRels(): string {
  return `${XML_HEADER}<Relationships xmlns="${RELS_NS}"><Relationship Id="rId1" Type="${DOC_RELS_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
}

function workbook(name: string): string {
  return `${XML_HEADER}<workbook xmlns="${MAIN_NS}" xmlns:r="${DOC_RELS_NS}"><sheets><sheet name="${xml(name)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
}

function workbookRels(): string {
  return `${XML_HEADER}<Relationships xmlns="${RELS_NS}"><Relationship Id="rId1" Type="${DOC_RELS_NS}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${DOC_RELS_NS}/styles" Target="styles.xml"/></Relationships>`;
}

/**
 * The style table.
 *
 * Minimal, but not shorter than minimal: Excel expects `fonts`, `fills`,
 * `borders`, `cellStyleXfs` and `cellXfs` to be present, and the fills list to
 * begin with `none` and `gray125` — a workbook missing either is reported as
 * corrupt rather than falling back to a default.
 */
function styles(code: CurrencyCode): string {
  return `${XML_HEADER}<styleSheet xmlns="${MAIN_NS}"><numFmts count="2"><numFmt numFmtId="${NUMFMT_CURRENCY}" formatCode="${xml(currencyFormat(code))}"/><numFmt numFmtId="${NUMFMT_DATE}" formatCode="dd mmm yyyy"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="${NUMFMT_CURRENCY}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="${NUMFMT_DATE}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

function inlineString(ref: string, value: string, style: number): string {
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

function numberCell(ref: string, value: number, style: number): string {
  return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
}

function cell(row: ExportRow, columnIndex: number, rowNumber: number): string {
  const column = EXPORT_COLUMNS[columnIndex];
  const ref = `${columnName(columnIndex)}${rowNumber}`;
  const value = row[column.key];

  switch (column.kind) {
    case "amount":
      return numberCell(ref, Number(value), STYLE_CURRENCY);
    case "date": {
      const serial = serialDate(String(value));

      // A date that will not parse is written as itself rather than dropped:
      // a visible oddity beats a silently empty cell.
      return serial === null
        ? inlineString(ref, String(value), STYLE_DEFAULT)
        : numberCell(ref, serial, STYLE_DATE);
    }
    default:
      return inlineString(ref, String(value), STYLE_DEFAULT);
  }
}

function sheet(rows: readonly ExportRow[]): string {
  const lastColumn = columnName(EXPORT_COLUMNS.length - 1);
  const lastRow = rows.length + 1;

  const cols = EXPORT_COLUMNS.map(
    (column, index) =>
      `<col min="${index + 1}" max="${index + 1}" width="${column.width}" customWidth="1"/>`,
  ).join("");

  const header = EXPORT_COLUMNS.map((column, index) =>
    inlineString(`${columnName(index)}1`, column.header, STYLE_HEADER),
  ).join("");

  const body = rows
    .map((row, index) => {
      const rowNumber = index + 2;
      const cells = EXPORT_COLUMNS.map((_, columnIndex) =>
        cell(row, columnIndex, rowNumber),
      ).join("");

      return `<row r="${rowNumber}">${cells}</row>`;
    })
    .join("");

  // Element order inside a worksheet is fixed by the schema: dimension,
  // sheetViews, cols, sheetData, then autoFilter. Excel will not open a
  // workbook that lists them in a friendlier order.
  return `${XML_HEADER}<worksheet xmlns="${MAIN_NS}"><dimension ref="A1:${lastColumn}${lastRow}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData><row r="1">${header}</row>${body}</sheetData><autoFilter ref="A1:${lastColumn}${lastRow}"/></worksheet>`;
}

function part(path: string, content: string): ZipEntry {
  return { path, data: Buffer.from(content, "utf8") };
}

/**
 * A one-sheet workbook of the given rows.
 *
 * `currency` styles the amount column. A group has exactly one currency (§10)
 * and a personal list uses the default, so one format for the whole column is
 * always right — and the code is still in its own column for anyone merging
 * two exports.
 */
export function toXlsx(
  rows: readonly ExportRow[],
  { currency, title }: { currency: CurrencyCode; title: string },
): Uint8Array {
  return createZip([
    part("[Content_Types].xml", contentTypes()),
    part("_rels/.rels", packageRels()),
    part("xl/workbook.xml", workbook(sheetName(title))),
    part("xl/_rels/workbook.xml.rels", workbookRels()),
    part("xl/styles.xml", styles(currency)),
    part("xl/worksheets/sheet1.xml", sheet(rows)),
  ]);
}
