import { FormPageSkeleton } from "@/components/ui/form-skeleton";

export default function Loading() {
  return <FormPageSkeleton label="Loading the group expense form" fields={7} />;
}
