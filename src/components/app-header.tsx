import { Wallet } from "lucide-react";
import Link from "next/link";

import { MainNav } from "@/components/main-nav";
import { SignOutButton } from "@/components/sign-out-button";
import { APP_NAME } from "@/lib/constants";

/**
 * Top bar for signed-in pages. Navigation sits beside the brand on wider
 * screens and drops to its own row on small ones, rather than being a
 * shrunken copy of a desktop sidebar (specification section 34).
 */
export function AppHeader({ name }: { name: string }) {
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto w-full max-w-5xl px-6">
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
            <Link
              href="/settings"
              className="max-w-32 truncate rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {name}
            </Link>
            <SignOutButton />
          </div>
        </div>

        <MainNav className="-mx-2 pb-2 sm:hidden" />
      </div>
    </header>
  );
}
