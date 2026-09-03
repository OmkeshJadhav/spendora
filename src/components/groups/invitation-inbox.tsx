import { Check, Users, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { SubmitAction } from "@/components/ui/submit-action";
import { formatTimestamp } from "@/lib/dates";
import { acceptInvitation, declineInvitation } from "@/lib/groups/actions";
import type { MyInvitation } from "@/lib/groups/queries";
import { currencyOf } from "@/lib/money";

/**
 * Invitations waiting for the signed-in user, answered in place.
 *
 * There is no link and no email in this path: the invitation is addressed to
 * this account's email, the database is what says so, and accepting is the same
 * membership insert an emailed link would have performed.
 *
 * Declining is behind a confirmation because it cannot be undone from here —
 * only the group's admin can invite again.
 */
export function InvitationInbox({
  invitations,
}: {
  invitations: MyInvitation[];
}) {
  return (
    <ul className="flex flex-col gap-3">
      {invitations.map((invitation) => {
        const currency = currencyOf(invitation.currencyCode);

        return (
          <li
            key={invitation.id}
            className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-accent">
                <Users className="size-4 text-accent-foreground" aria-hidden />
              </span>

              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{invitation.groupName}</span>
                  <Badge
                    variant={invitation.role === "admin" ? "success" : "neutral"}
                  >
                    As {invitation.role === "admin" ? "admin" : "member"}
                  </Badge>
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {invitation.inviterName} invited you
                  <span aria-hidden> · </span>
                  {currency.symbol} {currency.code}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Expires {formatTimestamp(invitation.expiresAt)}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <SubmitAction
                action={acceptInvitation}
                fields={{ invitationId: invitation.id }}
                label="Accept"
                ariaLabel={`Accept the invitation to ${invitation.groupName}`}
                icon={<Check aria-hidden />}
                toastId={`invitation-accept-${invitation.id}`}
              />
              <ConfirmAction
                action={declineInvitation}
                fields={{ invitationId: invitation.id }}
                label="Decline"
                confirmLabel="Decline"
                ariaLabel={`Decline the invitation to ${invitation.groupName}`}
                icon={<X aria-hidden />}
                toastId={`invitation-decline-${invitation.id}`}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
