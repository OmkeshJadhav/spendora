import type { Metadata } from "next";
import {
  CircleAlert,
  Clock,
  MailQuestionMark,
  UserCheck,
  Users,
} from "lucide-react";
import Link from "next/link";
import type { ComponentType, ReactNode } from "react";

import { AcceptInvitationForm } from "@/components/groups/accept-invitation-form";
import { SignOutButton } from "@/components/sign-out-button";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FadeIn } from "@/components/ui/fade-in";
import { requireProfile } from "@/lib/auth/dal";
import { formatTimestamp } from "@/lib/dates";
import { getInvitationPreview } from "@/lib/groups/queries";
import { currencyOf } from "@/lib/money";

export const metadata: Metadata = {
  title: "Group invitation",
  // A private, one-time link has no business in a search index.
  robots: { index: false, follow: false },
};

/**
 * The landing page for an invitation link (specification section 11).
 *
 * Everything shown here comes from `invitation_preview`, which is keyed by the
 * token's hash. Holding the link is what opens the page; it is not what joins
 * the group — that still needs a session whose email matches the invitation,
 * and the insert policy is what checks it.
 *
 * Signing in first is handled by the proxy: this route is private, so an
 * anonymous visitor is sent to `/sign-in?next=/invite/…` and comes back here.
 */
export default async function InvitePage(props: PageProps<"/invite/[token]">) {
  const { token } = await props.params;
  const profile = await requireProfile();
  const invitation = await getInvitationPreview(token);

  if (!invitation) {
    return (
      <Outcome
        icon={MailQuestionMark}
        title="This invitation link isn't valid"
        description="It may have been mistyped, withdrawn, or sent to a different email address than the one you're signed in with."
      >
        <SignedInAs email={profile.email} />
      </Outcome>
    );
  }

  const currency = currencyOf(invitation.currencyCode);

  if (invitation.isAlreadyMember) {
    return (
      <Outcome
        icon={UserCheck}
        title={`You're already in “${invitation.groupName}”`}
        description="Nothing to accept — this group is already in your list."
      >
        <Link href="/groups" className={buttonVariants()}>
          <Users aria-hidden />
          Go to your groups
        </Link>
      </Outcome>
    );
  }

  if (!invitation.isForCurrentUser) {
    return (
      <Outcome
        icon={CircleAlert}
        title="This invitation was sent to a different address"
        description={`It's addressed to ${invitation.inviteeEmailMasked}. Sign in with that account to accept it.`}
      >
        <SignedInAs email={profile.email} />
        <SignOutButton />
      </Outcome>
    );
  }

  if (invitation.status !== "pending") {
    return (
      <Outcome
        icon={MailQuestionMark}
        title="This invitation is no longer open"
        description={
          invitation.status === "accepted"
            ? "It has already been used."
            : "It was withdrawn by a group admin. Ask them for a new one."
        }
      />
    );
  }

  if (invitation.isExpired) {
    return (
      <Outcome
        icon={Clock}
        title="This invitation has expired"
        description={`It stopped working on ${formatTimestamp(invitation.expiresAt)}. Ask ${invitation.inviterName} to send a new one.`}
      />
    );
  }

  return (
    <FadeIn className="mx-auto flex w-full max-w-md flex-col gap-6">
      <Card>
        <CardContent className="flex flex-col gap-5 p-6 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent">
            <Users className="size-5 text-accent-foreground" aria-hidden />
          </span>

          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              {invitation.inviterName} invited you to join
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
              {invitation.groupName}
            </h1>
            <p className="flex flex-wrap items-center justify-center gap-2 text-sm text-muted-foreground">
              <span>
                {currency.symbol} {currency.label} ({currency.code})
              </span>
              <span aria-hidden>·</span>
              <Badge variant={invitation.role === "admin" ? "success" : "neutral"}>
                Joining as {invitation.role === "admin" ? "an admin" : "a member"}
              </Badge>
            </p>
          </div>

          <AcceptInvitationForm token={token} />

          <p className="text-xs text-muted-foreground">
            Expires {formatTimestamp(invitation.expiresAt)}. You&rsquo;re signed
            in as {profile.email}.
          </p>
        </CardContent>
      </Card>
    </FadeIn>
  );
}

/** Every dead end looks the same: what happened, and what to do about it. */
function Outcome({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <FadeIn className="mx-auto flex w-full max-w-md flex-col gap-6">
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-muted">
            <Icon className="size-5 text-muted-foreground" />
          </span>
          <h1 className="text-lg font-medium">{title}</h1>
          <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
          {children ? (
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              {children}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </FadeIn>
  );
}

function SignedInAs({ email }: { email: string }) {
  return (
    <p className="text-xs text-muted-foreground">Signed in as {email}.</p>
  );
}
