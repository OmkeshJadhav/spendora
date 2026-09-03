import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div role="status" className="mx-auto w-full max-w-md">
      <span className="sr-only">Loading invitation</span>
      <Skeleton className="h-64" />
    </div>
  );
}
