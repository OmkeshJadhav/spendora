import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div role="status" className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <span className="sr-only">Loading invitations</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-72" />
      </div>
      <Skeleton className="h-28" />
      <Skeleton className="h-28" />
    </div>
  );
}
