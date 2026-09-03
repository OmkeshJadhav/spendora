import { Bell } from "lucide-react";
import Link from "next/link";

/**
 * Pending invitations, surfaced wherever the user is (specification §34, which
 * puts notifications in the top bar).
 *
 * The count is rendered server-side from the same query the invitations page
 * uses, so the badge and the page can never disagree. It is a link, not a
 * popover: there is one kind of notification today, and it already has a page.
 */
export function NotificationBell({ count }: { count: number }) {
  const label =
    count === 0
      ? "Invitations"
      : `Invitations, ${count} waiting`;

  return (
    <Link
      href="/invitations"
      aria-label={label}
      className="relative flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Bell className="size-4" aria-hidden />
      {count > 0 ? (
        <span
          aria-hidden
          className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium leading-4 text-primary-foreground"
        >
          {count > 9 ? "9+" : count}
        </span>
      ) : null}
    </Link>
  );
}
