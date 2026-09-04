import { LayoutDashboard, ReceiptText, Tags, Users } from "lucide-react";
import type { ComponentType } from "react";

/**
 * The primary destinations (specification section 35).
 *
 * One list, two presentations: a row in the top bar on wide screens, a bottom
 * bar on narrow ones. Keeping the destinations here means the two can never
 * drift apart, and adding Reports or Settings later is a one-line change.
 */
export type NavLink = {
  href: "/dashboard" | "/expenses" | "/categories" | "/groups";
  label: string;
  icon: ComponentType<{ className?: string }>;
};

export const NAV_LINKS: NavLink[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/expenses", label: "Expenses", icon: ReceiptText },
  { href: "/categories", label: "Categories", icon: Tags },
  { href: "/groups", label: "Groups", icon: Users },
];

/** A destination is current when the path is it, or sits underneath it. */
export function isActive(pathname: string, href: NavLink["href"]): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
