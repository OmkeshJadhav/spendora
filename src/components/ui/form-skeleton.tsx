import { Skeleton } from "@/components/ui/skeleton";

/**
 * The loading state every form page shares (specification section 27).
 *
 * These pages look alike — a title, then one card of fields — so they skeleton
 * alike, and the shape roughly matches what arrives, which is what stops the
 * layout jumping when it does.
 */
export function FormPageSkeleton({
  /** Announced while the page is loading, e.g. "Loading the expense form". */
  label,
  /** Roughly how many fields the form has. */
  fields = 5,
}: {
  label: string;
  fields?: number;
}) {
  return (
    <div
      role="status"
      className="mx-auto flex w-full max-w-xl flex-col gap-6"
    >
      <span className="sr-only">{label}</span>

      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>

      <div className="flex flex-col gap-5 rounded-lg border border-border bg-card p-5">
        <Skeleton className="h-5 w-36" />

        {Array.from({ length: fields }, (_, index) => (
          <div key={index} className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}

        <Skeleton className="h-10 w-32" />
      </div>
    </div>
  );
}
