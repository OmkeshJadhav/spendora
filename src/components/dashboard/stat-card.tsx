import type { ComponentType } from "react";

import { Card } from "@/components/ui/card";

type StatCardProps = {
  title: string;
  value: string;
  /** Supporting line, such as what the figure is measured over. */
  hint?: string;
  icon: ComponentType<{ className?: string }>;
};

/** A dashboard figure: clear title, large value, subtle icon (section 37). */
export function StatCard({ title, value, hint, icon: Icon }: StatCardProps) {
  return (
    <Card className="flex items-start justify-between gap-3 p-5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <p className="tabular mt-1 truncate text-2xl font-semibold tracking-tight">
          {value}
        </p>
        {hint ? (
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </div>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent">
        <Icon className="size-4 text-accent-foreground" />
      </span>
    </Card>
  );
}
