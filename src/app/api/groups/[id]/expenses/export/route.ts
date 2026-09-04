import type { NextRequest } from "next/server";

import { requireUser } from "@/lib/auth/dal";
import {
  exportResponse,
  filtersFromRequest,
  formatFromRequest,
  tooLargeResponse,
} from "@/lib/export/response";
import { ExportTooLargeError, groupExportData } from "@/lib/export/queries";

/**
 * Downloads one group's expenses (specification §25).
 *
 * The counterpart of the personal export, and deliberately the same shape: the
 * filters arrive in the query string, the rows come back through the same
 * filter applier, and the file is written by the same two writers. The group's
 * own currency styles the amounts, and its name names the file.
 *
 * A group nobody may see and a group that does not exist both answer 404 here,
 * for the same reason the group pages do: RLS returns nothing in either case,
 * and telling the two apart would confirm the existence of a group to somebody
 * with no business knowing it.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/groups/[id]/expenses/export">,
) {
  await requireUser();

  const { id } = await context.params;
  const url = new URL(request.url);
  const filters = filtersFromRequest(url);

  try {
    const data = await groupExportData(id, filters);

    if (!data) {
      return new Response("Not found", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    return exportResponse(data, filters, formatFromRequest(url));
  } catch (error) {
    if (error instanceof ExportTooLargeError) {
      return tooLargeResponse();
    }

    throw error;
  }
}
