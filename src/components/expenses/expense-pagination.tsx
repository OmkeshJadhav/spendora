import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Page links for an expense list. Rendered only when there is more than one.
 *
 * `query` carries whatever else the list is scoped by — the group's filters,
 * for instance — so paging never silently drops them.
 */
export function ExpensePagination({
  page,
  pageCount,
  total,
  basePath = "/expenses",
  query = {},
}: {
  page: number;
  pageCount: number;
  total: number;
  basePath?: string;
  query?: Record<string, string>;
}) {
  if (pageCount <= 1) {
    return null;
  }

  const linkClass = buttonVariants({ variant: "secondary", size: "sm" });
  const disabledClass = "pointer-events-none opacity-50";

  // Page 1 has no `page=` parameter, so the first page has one canonical URL.
  const href = (target: number): string => {
    const params = new URLSearchParams(query);

    if (target > 1) {
      params.set("page", String(target));
    }

    const search = params.toString();

    return search ? `${basePath}?${search}` : basePath;
  };

  return (
    <nav
      aria-label="Expense pages"
      className="flex items-center justify-between gap-4"
    >
      <Link
        href={href(page - 1)}
        aria-disabled={page <= 1 || undefined}
        tabIndex={page <= 1 ? -1 : undefined}
        className={cn(linkClass, page <= 1 && disabledClass)}
      >
        <ChevronLeft aria-hidden />
        Previous
      </Link>

      <p className="text-xs text-muted-foreground" aria-live="polite">
        Page {page} of {pageCount} · {total}{" "}
        {total === 1 ? "expense" : "expenses"}
      </p>

      <Link
        href={href(page + 1)}
        aria-disabled={page >= pageCount || undefined}
        tabIndex={page >= pageCount ? -1 : undefined}
        className={cn(linkClass, page >= pageCount && disabledClass)}
      >
        Next
        <ChevronRight aria-hidden />
      </Link>
    </nav>
  );
}
