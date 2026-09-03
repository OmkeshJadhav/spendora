import { Plus } from "lucide-react";
import Link from "next/link";

/**
 * Floating action button for mobile (specification section 36). Hidden on
 * larger screens, where the header's "Add expense" button is always visible.
 */
export function AddExpenseFab() {
  return (
    <Link
      href="/expenses/new"
      aria-label="Add expense"
      className="fixed bottom-6 right-6 z-40 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-opacity hover:opacity-90 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:hidden"
    >
      <Plus className="size-6" aria-hidden />
    </Link>
  );
}
