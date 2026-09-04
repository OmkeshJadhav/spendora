"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { isActive, NAV_LINKS } from "@/components/nav-links";
import { cn } from "@/lib/utils";

/**
 * Bottom navigation for small screens (specification section 34, which asks
 * for a real mobile pattern rather than a shrunken desktop one).
 *
 * A bottom bar rather than a second row under the header: it stays put while
 * the page scrolls, so switching section is always one thumb-reach away
 * instead of a scroll back to the top, and four destinations fit a narrow
 * screen when the label sits under the icon rather than beside it.
 *
 * The bar sits above the page in the stacking order but out of the document
 * flow, so `DashboardLayout` reserves the space it occupies — nothing at the
 * bottom of a page ends up underneath it.
 */
export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card sm:hidden"
    >
      <ul className="flex items-stretch">
        {NAV_LINKS.map((link) => {
          const active = isActive(pathname, link.href);

          return (
            <li key={link.href} className="flex-1">
              <Link
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  // A 56px target, comfortably over the 44px minimum a touch
                  // control wants.
                  "relative flex h-14 flex-col items-center justify-center gap-1 text-[11px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  active
                    ? "font-medium text-primary"
                    : "text-muted-foreground",
                )}
              >
                <link.icon className="size-5" />
                {link.label}
                {/* Current section is marked by shape as well as colour, so
                    it does not depend on telling two hues apart (section 40). */}
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-1/2 top-0 h-0.5 w-10 -translate-x-1/2 rounded-b-full",
                    active ? "bg-primary" : "bg-transparent",
                  )}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
