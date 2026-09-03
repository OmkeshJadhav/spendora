import { ArrowLeft, Settings } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { currencyOf } from "@/lib/money";
import type { CurrencyCode, GroupRole } from "@/types";

/**
 * Which group you are looking at, and in what currency (specification 59).
 *
 * Rendered at the top of every page inside a group, so the answer to "whose
 * money is this?" is never more than a glance away.
 */
export function GroupContext({
  groupId,
  name,
  description,
  currencyCode,
  role,
  showSettings = false,
  backHref = "/groups",
  backLabel = "All groups",
}: {
  groupId: string;
  name: string;
  description: string | null;
  currencyCode: CurrencyCode;
  role: GroupRole;
  showSettings?: boolean;
  backHref?: string;
  backLabel?: string;
}) {
  const currency = currencyOf(currencyCode);

  return (
    <div className="flex flex-col gap-3">
      <Link
        href={backHref}
        className="inline-flex w-fit items-center gap-1.5 rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {backLabel}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>
              Currency: {currency.symbol} {currency.label} ({currency.code})
            </span>
            <span aria-hidden>·</span>
            <Badge variant={role === "admin" ? "success" : "neutral"}>
              You are {role === "admin" ? "an admin" : "a member"}
            </Badge>
          </p>
          {description ? (
            <p className="mt-2 max-w-prose text-sm text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>

        {showSettings ? (
          <Link
            href={`/groups/${groupId}/settings`}
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            <Settings aria-hidden />
            Group settings
          </Link>
        ) : null}
      </div>
    </div>
  );
}
