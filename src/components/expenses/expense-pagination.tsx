import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Page links for the expense list. Rendered only when there is more than one. */
export function ExpensePagination({
  page,
  pageCount,
  total,
}: {
  page: number;
  pageCount: number;
  total: number;
}) {
  if (pageCount <= 1) {
    return null;
  }

  const linkClass = buttonVariants({ variant: "secondary", size: "sm" });
  const disabledClass = "pointer-events-none opacity-50";

  return (
    <nav
      aria-label="Expense pages"
      className="flex items-center justify-between gap-4"
    >
      <Link
        href={page > 2 ? `/expenses?page=${page - 1}` : "/expenses"}
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
        href={`/expenses?page=${page + 1}`}
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
