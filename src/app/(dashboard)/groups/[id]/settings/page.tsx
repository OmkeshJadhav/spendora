import type { Metadata } from "next";
import { Trash2 } from "lucide-react";
import { notFound } from "next/navigation";

import { FlashToast } from "@/components/flash-toast";
import { GroupContext } from "@/components/groups/group-context";
import { GroupForm } from "@/components/groups/group-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { FadeIn } from "@/components/ui/fade-in";
import { requireUser } from "@/lib/auth/dal";
import { deleteGroup, updateGroup } from "@/lib/groups/actions";
import { getGroupDetail, groupHasExpenses } from "@/lib/groups/queries";

export const metadata: Metadata = {
  title: "Group settings",
};

export default async function GroupSettingsPage(
  props: PageProps<"/groups/[id]/settings">,
) {
  const { id } = await props.params;
  await requireUser();

  const detail = await getGroupDetail(id);

  if (!detail) {
    notFound();
  }

  // A member reaching this URL directly gets the same answer as a stranger.
  // The database would refuse the writes anyway; this is so the page never
  // offers a control that cannot work.
  if (!detail.isAdmin) {
    notFound();
  }

  const searchParams = await props.searchParams;
  const flash = Array.isArray(searchParams.flash)
    ? searchParams.flash[0]
    : searchParams.flash;

  const { group, role } = detail;
  const currencyLocked = await groupHasExpenses(group.id);

  return (
    <FadeIn className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <FlashToast flash={flash} path={`/groups/${group.id}/settings`} />

      <GroupContext
        groupId={group.id}
        name={group.name}
        description={null}
        currencyCode={group.currency_code}
        role={role}
        backHref={`/groups/${group.id}`}
        backLabel="Back to group"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-foreground">
            Group details
          </CardTitle>
          <CardDescription>
            Only admins can change these. Members see the result everywhere.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GroupForm
            action={updateGroup.bind(null, group.id)}
            defaults={{
              name: group.name,
              description: group.description ?? "",
              currencyCode: group.currency_code,
            }}
            currencyLocked={currencyLocked}
            submitLabel="Save changes"
            cancelHref={`/groups/${group.id}`}
          />
        </CardContent>
      </Card>

      <Card className="border-danger/30">
        <CardHeader>
          <CardTitle className="text-base text-foreground">
            Delete this group
          </CardTitle>
          <CardDescription>
            Its members, invitations, categories, budgets and expenses go with
            it. This cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ConfirmAction
            action={deleteGroup}
            fields={{ groupId: group.id }}
            label="Delete group"
            confirmLabel="Delete permanently"
            icon={<Trash2 aria-hidden />}
            variant="danger"
            size="md"
            toastId="group-delete"
          />
        </CardContent>
      </Card>
    </FadeIn>
  );
}
