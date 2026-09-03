import { MailX, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { formatTimestamp } from "@/lib/dates";
import { dismissInvitation, revokeInvitation } from "@/lib/groups/actions";
import type { PendingInvitation } from "@/lib/groups/queries";

/**
 * Outstanding invitations, admins only.
 *
 * Declined ones are listed too. An admin who cannot see that somebody said no
 * would re-invite them blindly; declining also frees the "one pending
 * invitation per email" slot, so re-inviting is possible and should be a
 * decision rather than an accident.
 *
 * The token is not here and cannot be: only its hash was stored. Re-inviting
 * issues a fresh one, which is the right shape anyway — a link that can be
 * re-read from a screen is a link that outlives the person who needed it.
 */
export function InvitationList({
  groupId,
  invitations,
}: {
  groupId: string;
  invitations: PendingInvitation[];
}) {
  return (
    <ul className="divide-y divide-border">
      {invitations.map((invitation) => {
        const declined = invitation.status === "declined";

        return (
          <li
            key={invitation.id}
            className="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <span className="truncate">{invitation.email}</span>
                <Badge
                  variant={
                    declined
                      ? "danger"
                      : invitation.isExpired
                        ? "warning"
                        : "neutral"
                  }
                >
                  {declined
                    ? "Declined"
                    : invitation.isExpired
                      ? "Expired"
                      : "Pending"}
                </Badge>
                {invitation.role === "admin" ? <Badge>As admin</Badge> : null}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {invitation.inviterName
                  ? `Invited by ${invitation.inviterName}`
                  : "Invited"}
                <span aria-hidden> · </span>
                {declined ? (
                  <>Declined — you can invite them again</>
                ) : (
                  <>
                    {invitation.isExpired ? "Expired" : "Expires"}{" "}
                    {formatTimestamp(invitation.expires_at)}
                  </>
                )}
              </p>
            </div>

            {declined ? (
              <ConfirmAction
                action={dismissInvitation.bind(null, groupId)}
                fields={{ invitationId: invitation.id }}
                label="Remove"
                confirmLabel="Remove"
                ariaLabel={`Remove the declined invitation for ${invitation.email}`}
                icon={<Trash2 aria-hidden />}
                toastId={`invitation-dismiss-${invitation.id}`}
                compact
              />
            ) : (
              <ConfirmAction
                action={revokeInvitation.bind(null, groupId)}
                fields={{ invitationId: invitation.id }}
                label="Revoke"
                confirmLabel="Revoke"
                ariaLabel={`Revoke the invitation for ${invitation.email}`}
                icon={<MailX aria-hidden />}
                toastId={`invitation-revoke-${invitation.id}`}
                compact
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
