import type { ComponentType, ReactNode } from "react";

import { cn } from "@/lib/utils";

type EmptyStateProps = {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  /** A call to action — usually a button or a link styled as one. */
  action?: ReactNode;
  className?: string;
};

/**
 * Shown wherever there is no data, so a screen is never simply blank
 * (specification section 26).
 */
function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 px-6 py-14 text-center",
        className,
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-accent">
        <Icon className="size-5 text-accent-foreground" />
      </span>
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-medium text-foreground">{title}</h3>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          {description}
        </p>
      </div>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export { EmptyState };
