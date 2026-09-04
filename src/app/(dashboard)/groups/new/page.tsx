import type { Metadata } from "next";

import { GroupForm } from "@/components/groups/group-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FadeIn } from "@/components/ui/fade-in";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/dal";
import { createGroup } from "@/lib/groups/actions";

export const metadata: Metadata = {
  title: "Create group",
};

export default async function NewGroupPage() {
  await requireUser();

  return (
    <FadeIn className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <PageHeader
        title="Create a group"
        description={
          <>You&rsquo;ll be its admin, and can invite people once it exists.</>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Group details</CardTitle>
          <CardDescription>
            Everything in this group is shared with its members.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GroupForm
            action={createGroup}
            submitLabel="Create group"
            cancelHref="/groups"
          />
        </CardContent>
      </Card>
    </FadeIn>
  );
}
