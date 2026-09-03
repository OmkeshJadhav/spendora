import { ArrowRight, Users } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { FadeIn } from "@/components/ui/fade-in";
import { currencyOf } from "@/lib/money";
import type { GroupSummary } from "@/lib/groups/queries";

/**
 * The user's groups (specification section 35).
 *
 * Each card states the currency, because it is the one piece of group context
 * that changes what every number in it means.
 */
export function GroupList({ groups }: { groups: GroupSummary[] }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {groups.map((group, index) => {
        const currency = currencyOf(group.currency_code);

        return (
          <li key={group.id}>
            {/* Staggered gently; the delay caps so a long list does not crawl. */}
            <FadeIn delay={Math.min(index, 6) * 0.04}>
              <Card className="h-full transition-colors hover:border-ring">
                <Link
                  href={`/groups/${group.id}`}
                  className="flex h-full flex-col gap-3 p-5 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-lg"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="font-medium">{group.name}</h2>
                    <ArrowRight
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                  </div>

                  {group.description ? (
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {group.description}
                    </p>
                  ) : null}

                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
                    <Badge variant={group.role === "admin" ? "success" : "neutral"}>
                      {group.role === "admin" ? "Admin" : "Member"}
                    </Badge>
                    <span className="inline-flex items-center gap-1">
                      <Users aria-hidden className="size-3.5" />
                      {group.memberCount}{" "}
                      {group.memberCount === 1 ? "member" : "members"}
                    </span>
                    <span aria-hidden>·</span>
                    <span>
                      {currency.symbol} {currency.code}
                    </span>
                  </div>
                </Link>
              </Card>
            </FadeIn>
          </li>
        );
      })}
    </ul>
  );
}
