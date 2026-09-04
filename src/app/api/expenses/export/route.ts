import type { NextRequest } from "next/server";

import { requireUser } from "@/lib/auth/dal";
import {
  exportResponse,
  filtersFromRequest,
  formatFromRequest,
  tooLargeResponse,
} from "@/lib/export/response";
import {
  ExportTooLargeError,
  personalExportData,
} from "@/lib/export/queries";

/**
 * Downloads the signed-in user's personal expenses (specification §25).
 *
 * A GET route handler rather than a Server Action, because a download is an
 * HTTP response with a `Content-Disposition` — and because it makes the export
 * a plain link. That keeps it consistent with the rest of Phase 9's surface:
 * the same filters travel in the same query string, so "export what I am
 * looking at" is the link the list already knows how to build, it is
 * shareable, and it works with JavaScript turned off.
 *
 * Authorization is stated twice on purpose. `requireUser()` is the gate — the
 * proxy's redirect is an optimistic check for navigation and not something a
 * data route should lean on — and RLS is what actually confines the rows.
 */
export async function GET(request: NextRequest) {
  await requireUser();

  const url = new URL(request.url);
  const filters = filtersFromRequest(url);

  try {
    const data = await personalExportData(filters);

    return exportResponse(data, filters, formatFromRequest(url));
  } catch (error) {
    if (error instanceof ExportTooLargeError) {
      return tooLargeResponse();
    }

    throw error;
  }
}
