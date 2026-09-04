"use client";

import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { toast } from "sonner";

import { buttonVariants } from "@/components/ui/button";
import { EXPORT_FORMATS, type ExportFormat } from "@/lib/export/format";
import {
  filterParams,
  withParams,
  type ExpenseFilters,
} from "@/lib/expenses/filters";

/**
 * The export controls above an expense list (specification §25).
 *
 * Two ordinary links to a route handler, carrying the filters that are in
 * force — so the file is what the screen is showing, and the same rules Phase 9
 * wrote for narrowing a list decide what lands in the spreadsheet. Being links
 * rather than buttons means an export is shareable, repeatable and works with
 * JavaScript turned off; the client component exists only for the toast.
 *
 * The toast says the download has started, which is what is actually known at
 * that moment. §2 lists an "export completed" notification, and a browser does
 * not tell a page when it has finished saving a file — so it says the true
 * thing rather than the confident one.
 *
 * The formats come from the registry, so adding one adds a link here.
 */

const ICONS: Record<ExportFormat, typeof FileText> = {
  csv: FileText,
  xlsx: FileSpreadsheet,
};

export function ExportMenu({
  basePath,
  filters,
  className,
}: {
  /** The export route, e.g. `/api/expenses/export`. */
  basePath: string;
  filters: ExpenseFilters;
  className?: string;
}) {
  const params = filterParams(filters);

  return (
    <div className={className}>
      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Export these expenses"
      >
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Download aria-hidden className="size-4" />
          Export
        </span>

        {(Object.keys(EXPORT_FORMATS) as ExportFormat[]).map((format) => {
          const Icon = ICONS[format];
          const { label } = EXPORT_FORMATS[format];

          return (
            <a
              key={format}
              href={withParams(basePath, { ...params, format })}
              // Same-origin, and the route sends Content-Disposition anyway —
              // this only spares the browser a moment's guessing.
              download
              onClick={() =>
                toast.success(`Your ${label} export is downloading.`, {
                  id: "export",
                })
              }
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              <Icon aria-hidden />
              {label}
            </a>
          );
        })}
      </div>
    </div>
  );
}
