import { ModalFormSkeleton } from "@/components/ui/form-skeleton";

export default function Loading() {
  return <ModalFormSkeleton label="Loading the expense form" fields={7} />;
}
