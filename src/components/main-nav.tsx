"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { isActive, NAV_LINKS } from "@/components/nav-links";
import { cn } from "@/lib/utils";

/**
 * Primary navigation for wide screens (specification section 35).
 *
 * Narrow screens get `MobileNav` instead — a bottom bar, not this row shrunk
 * down (section 34). Both read the same `NAV_LINKS`.
 */
export function MainNav({ className }: { className?: string }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className={cn("flex items-center gap-1", className)}>
      {NAV_LINKS.map((link) => {
        const active = isActive(pathname, link.href);

        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <link.icon className="size-4" />
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
