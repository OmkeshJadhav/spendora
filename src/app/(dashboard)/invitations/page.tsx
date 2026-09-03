import type { Metadata } from "next";
import { MailCheck, Plus } from "lucide-react";
import Link from "next/link";

import { FlashToast } from "@/components/flash-toast";
import { InvitationInbox } from "@/components/groups/invitation-inbox";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FadeIn } from "@/components/ui/fade-in";
import { requireProfile } from "@/lib/auth/dal";
import { listMyInvitations } from "@/lib/groups/queries";

export const metadata: Metadata = {
  title: "Invitations",
};

export default async function InvitationsPage(props: PageProps<"/invitations">) {
  const profile = await requireProfile();
  const invitations = await listMyInvitations();

  const searchParams = await props.searchParams;
  const flash = Array.isArray(searchParams.flash)
    ? searchParams.flash[0]
    : searchParams.flash;

  return (
    <FadeIn className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <FlashToast flash={flash} path="/invitations" />

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Invitations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Groups you&rsquo;ve been invited to join, addressed to {profile.email}.
          Nothing in a group is visible to you until you accept.
        </p>
      </div>

      {invitations.length === 0 ? (
        <Card>
          <EmptyState
            icon={MailCheck}
            title="No invitations waiting"
            description="When someone invites you to a group, it appears here for you to accept or decline."
            action={
              <Link href="/groups" className={buttonVariants({ variant: "secondary" })}>
                <Plus aria-hidden />
                Create a group instead
              </Link>
            }
          />
        </Card>
      ) : (
        <InvitationInbox invitations={invitations} />
      )}
    </FadeIn>
  );
}
