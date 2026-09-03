import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * A native `<select>`, styled to match `Input`.
 *
 * Native is deliberate: it is keyboard accessible and screen-reader correct
 * without any code of ours, and on mobile it opens the platform's own picker,
 * which beats anything a custom popover would do on a small screen.
 */
function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        className={cn(
          "flex h-10 w-full appearance-none rounded-md border border-input bg-card px-3 py-2 pr-9 text-sm outline-none transition-colors",
          "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "aria-invalid:border-danger aria-invalid:ring-danger/30",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}

export { Select };
