import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, rows = 3, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      rows={rows}
      className={cn(
        "flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none transition-colors",
        "placeholder:text-muted-foreground",
        "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-danger aria-invalid:ring-danger/30",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
