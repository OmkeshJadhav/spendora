import { UserMinus } from "lucide-react";

import { MemberRoleForm } from "@/components/groups/member-role-form";
import { Badge } from "@/components/ui/badge";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { formatTimestamp } from "@/lib/dates";
import { removeMember, updateMemberRole } from "@/lib/groups/actions";
import type { GroupMemberView } from "@/lib/groups/queries";

/**
 * Who is in the group, and what they may do (specification sections 9 and 21).
 *
 * Role is stated in words as well as shown as a badge, and the controls that
 * change it only render for admins — the database refuses them for anyone
 * else regardless, so this is about not offering what cannot be done.
 *
 * Email addresses are shown to admins only. An admin invites by address and
 * needs to see which one somebody joined under; a member needs a name. RLS
 * lets group peers read each other's profile rows either way (the trade-off
 * `profiles_select_group_peers` records), so this narrows what the application
 * puts on screen rather than what the database will hand out — but the screen
 * is where an address is actually read, copied and carried off.
 */
export function MemberList({
  groupId,
  members,
  isAdmin,
  adminCount,
}: {
  groupId: string;
  members: GroupMemberView[];
  isAdmin: boolean;
  adminCount: number;
}) {
  return (
    <ul className="divide-y divide-border">
      {members.map((member) => {
        const name = member.profile?.name ?? "Former member";
        // The last admin cannot be demoted or removed; a group must keep one.
        const isLastAdmin = member.role === "admin" && adminCount === 1;

        return (
          <li
            key={member.id}
            className="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <span className="truncate">{name}</span>
                {member.isSelf ? <Badge>You</Badge> : null}
                <Badge variant={member.role === "admin" ? "success" : "neutral"}>
                  {member.role === "admin" ? "Admin" : "Member"}
                </Badge>
              </p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {isAdmin ? (
                  <>
                    {member.profile?.email ?? "Account removed"}
                    <span aria-hidden> · </span>
                  </>
                ) : null}
                Joined {formatTimestamp(member.joined_at)}
              </p>
            </div>

            {isAdmin ? (
              <div className="flex items-center gap-2">
                {isLastAdmin ? (
                  <p className="text-xs text-muted-foreground">
                    Sole admin — appoint another before changing this
                  </p>
                ) : (
                  <>
                    <MemberRoleForm
                      action={updateMemberRole.bind(null, groupId)}
                      memberId={member.id}
                      memberName={name}
                      role={member.role}
                    />
                    {member.isSelf ? null : (
                      <ConfirmAction
                        action={removeMember.bind(null, groupId)}
                        fields={{ memberId: member.id }}
                        label="Remove"
                        confirmLabel="Remove"
                        ariaLabel={`Remove ${name} from this group`}
                        icon={<UserMinus aria-hidden />}
                        toastId={`member-remove-${member.id}`}
                        compact
                      />
                    )}
                  </>
                )}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
