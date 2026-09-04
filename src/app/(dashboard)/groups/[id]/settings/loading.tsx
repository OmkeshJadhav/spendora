import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div role="status" className="flex flex-col gap-6">
      <span className="sr-only">Loading group settings</span>
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-8 w-56" />
      {/* Group details, members and invitations. */}
      <Skeleton className="h-64" />
      <Skeleton className="h-56" />
      <Skeleton className="h-48" />
    </div>
  );
}
