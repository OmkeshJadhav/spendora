import { Plus } from "lucide-react";
import Link from "next/link";

/**
 * Floating action button for mobile (specification section 36). Hidden on
 * larger screens, where the header's "Add expense" button is always visible.
 *
 * It sits above the bottom navigation bar rather than over it: `bottom-20`
 * clears the bar's 3.5rem, and `mb-safe` clears the iOS home indicator
 * underneath that.
 *
 * `href` defaults to the personal form; a group list passes its own, so the
 * button always adds an expense to the list being looked at.
 */
export function AddExpenseFab({
  href = "/expenses/new",
  label = "Add expense",
}: {
  href?: string;
  label?: string;
} = {}) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="mb-safe fixed bottom-20 right-4 z-40 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-opacity hover:opacity-90 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:hidden"
    >
      <Plus className="size-6" aria-hidden />
    </Link>
  );
}
