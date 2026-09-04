import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type PageHeaderProps = {
  title: string;
  /** One line saying what this page holds, or what is currently in scope. */
  description?: ReactNode;
  /** The page's primary action, usually a button or a link styled as one. */
  action?: ReactNode;
  className?: string;
};

/**
 * The title block every page opens with.
 *
 * Ten pages had grown their own copy of the same three elements, which is how
 * a heading ends up a step larger on one page than another. One component
 * means one type scale, one gap, and one `h1` per page — which is also what a
 * screen reader expects to find.
 */
export function PageHeader({
  title,
  description,
  action,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-x-4 gap-y-3",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          // `data-slot` rather than a class name is what the verification
          // suites match on, so restyling this line cannot fail a test that
          // is really asking whether the summary is there.
          <p
            data-slot="page-description"
            className="mt-1 max-w-prose text-sm text-muted-foreground"
          >
            {description}
          </p>
        ) : null}
      </div>

      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
