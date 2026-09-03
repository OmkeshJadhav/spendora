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
import { requireUser } from "@/lib/auth/dal";
import { createGroup } from "@/lib/groups/actions";

export const metadata: Metadata = {
  title: "Create group",
};

export default async function NewGroupPage() {
  await requireUser();

  return (
    <FadeIn className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Create a group</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          You&rsquo;ll be its admin, and can invite people once it exists.
        </p>
      </div>

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
