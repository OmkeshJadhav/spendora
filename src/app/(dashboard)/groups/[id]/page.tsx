import type { Metadata } from "next";
import { LogOut, MailPlus, ReceiptText, Users } from "lucide-react";
import { notFound } from "next/navigation";

import { FlashToast } from "@/components/flash-toast";
import { GroupContext } from "@/components/groups/group-context";
import { InvitationList } from "@/components/groups/invitation-list";
import { InviteForm } from "@/components/groups/invite-form";
import { MemberList } from "@/components/groups/member-list";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { EmptyState } from "@/components/ui/empty-state";
import { FadeIn } from "@/components/ui/fade-in";
import { requireUser } from "@/lib/auth/dal";
import { inviteMember, leaveGroup } from "@/lib/groups/actions";
import { getGroupDetail } from "@/lib/groups/queries";

export const metadata: Metadata = {
  title: "Group",
};

export default async function GroupPage(props: PageProps<"/groups/[id]">) {
  const { id } = await props.params;
  await requireUser();

  const detail = await getGroupDetail(id);

  // Covers both "no such group" and "not a member of it": RLS returns nothing
  // in either case, and the two should be indistinguishable from outside.
  if (!detail) {
    notFound();
  }

  const searchParams = await props.searchParams;
  const flash = Array.isArray(searchParams.flash)
    ? searchParams.flash[0]
    : searchParams.flash;

  const { group, role, isAdmin, members, invitations } = detail;
  const adminCount = members.filter((member) => member.role === "admin").length;
  const isSoleAdmin = isAdmin && adminCount === 1;

  return (
    <FadeIn className="flex flex-col gap-6">
      <FlashToast flash={flash} path={`/groups/${group.id}`} />

      <GroupContext
        groupId={group.id}
        name={group.name}
        description={group.description}
        currencyCode={group.currency_code}
        role={role}
        showSettings={isAdmin}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-foreground">
            <Users aria-hidden className="size-4 text-muted-foreground" />
            Members
          </CardTitle>
          <CardDescription>
            {members.length} {members.length === 1 ? "person" : "people"} can see
            and add this group&rsquo;s expenses.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MemberList
            groupId={group.id}
            members={members}
            isAdmin={isAdmin}
            adminCount={adminCount}
          />
        </CardContent>
      </Card>

      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-foreground">
              <MailPlus aria-hidden className="size-4 text-muted-foreground" />
              Invite people
            </CardTitle>
            <CardDescription>
              The invitation appears in their Spendora invitations, to accept or
              decline. Nothing in this group is visible to them until they
              accept. Someone without an account yet gets a link instead.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <InviteForm action={inviteMember.bind(null, group.id)} />

            {invitations.length > 0 ? (
              <div>
                <h3 className="mb-1 text-sm font-medium">
                  Pending invitations
                </h3>
                <InvitationList
                  groupId={group.id}
                  invitations={invitations}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-foreground">
            <ReceiptText aria-hidden className="size-4 text-muted-foreground" />
            Expenses
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Group expenses arrive in the next phase; saying so beats a blank
              panel or a button that does nothing. */}
          <EmptyState
            icon={ReceiptText}
            title="Group expenses are coming next"
            description="Members, roles and invitations are in place. Recording shared expenses in this group is the next piece of work."
            className="py-8"
          />
        </CardContent>
      </Card>

      <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <p className="text-sm font-medium">Leave this group</p>
          <p className="text-xs text-muted-foreground">
            {isSoleAdmin
              ? "You're the only admin. Make someone else an admin first, or delete the group from its settings."
              : "You'll lose access to its expenses. Expenses you recorded stay with the group."}
          </p>
        </div>

        {isSoleAdmin ? null : (
          <ConfirmAction
            action={leaveGroup}
            fields={{ groupId: group.id }}
            label="Leave group"
            confirmLabel="Leave"
            icon={<LogOut aria-hidden />}
            toastId="group-leave"
          />
        )}
      </Card>
    </FadeIn>
  );
}
