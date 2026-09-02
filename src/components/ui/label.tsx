import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

function Label({ className, children, ...props }: ComponentProps<"label">) {
  return (
    <label
      className={cn(
        "text-sm font-medium text-foreground select-none",
        className,
      )}
      {...props}
    >
      {children}
    </label>
  );
}

export { Label };
