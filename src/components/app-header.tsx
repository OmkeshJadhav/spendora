import { Wallet } from "lucide-react";
import Link from "next/link";

import { MainNav } from "@/components/main-nav";
import { NotificationBell } from "@/components/notification-bell";
import { SignOutButton } from "@/components/sign-out-button";
import { APP_NAME } from "@/lib/constants";

/**
 * Top bar for signed-in pages (specification section 34).
 *
 * On wide screens navigation sits beside the brand. On narrow ones it moves to
 * the bottom bar (`MobileNav`) rather than wrapping to a second row here,
 * which kept the header tall and pushed four labelled links across a screen
 * too narrow to hold them.
 */
export function AppHeader({
  name,
  invitationCount,
}: {
  name: string;
  invitationCount: number;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card">
      <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
        <div className="flex h-14 items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Link
              href="/dashboard"
              className="flex items-center gap-2 text-sm font-medium rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Wallet className="size-4 text-primary" aria-hidden />
              {APP_NAME}
            </Link>

            <MainNav className="hidden sm:flex" />
          </div>

          <div className="flex items-center gap-1">
            <NotificationBell count={invitationCount} />
            <Link
              href="/settings"
              className="max-w-32 truncate rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {name}
            </Link>
            <SignOutButton />
          </div>
        </div>
      </div>
    </header>
  );
}
