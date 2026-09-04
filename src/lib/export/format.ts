/**
 * The formats an expense export can be downloaded in (specification §25).
 *
 * A registry rather than a pair of branches. §25 asks that the architecture
 * stay open to XLSX and PDF being added later, and this is what that means in
 * practice: a new format is an entry here, a writer beside the two that exist,
 * and one arm of the switch in the route handler. Nothing else in the
 * application needs to know how many formats there are — the export links map
 * over this object, so a third one appears in the UI by existing.
 */

export const EXPORT_FORMATS = {
  csv: {
    label: "CSV",
    extension: "csv",
    /**
     * RFC 4180's media type. The charset is stated rather than left to the
     * client to guess, because the file carries a UTF-8 BOM — see `csv.ts`.
     */
    contentType: "text/csv; charset=utf-8",
  },
  xlsx: {
    label: "Excel",
    extension: "xlsx",
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
} as const;

export type ExportFormat = keyof typeof EXPORT_FORMATS;

/** What a link with no `format` gets. §25 requires CSV; Excel is the extra. */
export const DEFAULT_EXPORT_FORMAT: ExportFormat = "csv";

/**
 * Reads the `format` parameter, falling back rather than rejecting.
 *
 * Same leniency as the filters this travels with (see `filters.ts`): a stale
 * or hand-typed link should produce a download, not an error page. The value
 * only ever selects a writer, so an unreadable one costs nothing.
 */
export function parseExportFormat(
  value: string | null | undefined,
): ExportFormat {
  return value && value in EXPORT_FORMATS
    ? (value as ExportFormat)
    : DEFAULT_EXPORT_FORMAT;
}
