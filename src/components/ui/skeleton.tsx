import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/** Placeholder block used while data loads. Hidden from screen readers. */
function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

export { Skeleton };
