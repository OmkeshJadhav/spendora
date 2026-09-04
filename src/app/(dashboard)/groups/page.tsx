import type { Metadata } from "next";
import { Plus, Users } from "lucide-react";
import Link from "next/link";

import { FlashToast } from "@/components/flash-toast";
import { GroupList } from "@/components/groups/group-list";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FadeIn } from "@/components/ui/fade-in";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/dal";
import { listMyGroups } from "@/lib/groups/queries";

export const metadata: Metadata = {
  title: "Groups",
};

export default async function GroupsPage(props: PageProps<"/groups">) {
  await requireUser();

  const searchParams = await props.searchParams;
  const flash = Array.isArray(searchParams.flash)
    ? searchParams.flash[0]
    : searchParams.flash;

  const groups = await listMyGroups();

  return (
    <FadeIn className="flex flex-col gap-6">
      <FlashToast flash={flash} path="/groups" />

      <PageHeader
        title="Groups"
        description="Shared expenses. Everyone in a group can see its records."
        action={
          <Link href="/groups/new" className={buttonVariants({ size: "md" })}>
            <Plus aria-hidden />
            Create group
          </Link>
        }
      />

      {groups.length === 0 ? (
        <Card>
          <EmptyState
            icon={Users}
            title="You haven't joined any groups yet"
            description="Create one to split a trip, a flat or a team's costs. If someone has invited you, it will be waiting under Invitations."
            action={
              <Link href="/groups/new" className={buttonVariants()}>
                <Plus aria-hidden />
                Create group
              </Link>
            }
          />
        </Card>
      ) : (
        <GroupList groups={groups} />
      )}
    </FadeIn>
  );
}
