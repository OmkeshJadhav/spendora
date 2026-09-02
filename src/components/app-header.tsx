import { Wallet } from "lucide-react";
import Link from "next/link";

import { SignOutButton } from "@/components/sign-out-button";
import { APP_NAME } from "@/lib/constants";

/**
 * Top bar for signed-in pages. The full navigation (Dashboard, Expenses,
 * Groups, Reports, Settings) is built once those sections exist.
 */
export function AppHeader({ name }: { name: string }) {
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-6">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 text-sm font-medium rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Wallet className="size-4 text-primary" aria-hidden />
          {APP_NAME}
        </Link>

        <div className="flex items-center gap-1">
          <Link
            href="/settings"
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {name}
          </Link>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
