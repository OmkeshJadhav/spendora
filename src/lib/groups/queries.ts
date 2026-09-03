import "server-only";

import { cache } from "react";

import { requireUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { hashInvitationToken, isPlausibleToken } from "@/lib/groups/tokens";
import type {
  CurrencyCode,
  Group,
  GroupInvitation,
  GroupMember,
  GroupRole,
  InvitationStatus,
  Profile,
} from "@/types";

/**
 * Reads of the groups the signed-in user belongs to.
 *
 * RLS is what makes these safe: `groups` is readable only by its members, and
 * `group_invitations` only by a group's admins or the person invited. Nothing
 * here re-implements that check — it queries as the user and takes what comes
 * back, so a missing group and a group the user may not see are the same
 * result, which is exactly what the caller should render.
 *
 * Relationships are resolved with a second query rather than a PostgREST embed:
 * `group_members` and `profiles` are joined through one key each, but the
 * codebase already fetches categories this way and the shapes stay obvious.
 */

const GROUP_COLUMNS =
  "id, name, description, currency_code, created_by, created_at, updated_at";

const MEMBER_COLUMNS =
  "id, group_id, user_id, role, joined_at, created_at, updated_at";

/** No `token_hash`: nothing that renders an invitation needs it. */
const INVITATION_COLUMNS =
  "id, group_id, email, role, invited_by, status, expires_at, accepted_at, accepted_by, created_at, updated_at";

function failed(context: string, message: string): never {
  // Detail stays server-side; the error boundary shows friendly copy.
  console.error(`[groups:${context}]`, message);
  throw new Error("We couldn't load your groups. Please try again.");
}

export type MemberProfile = Pick<Profile, "id" | "name" | "email">;

/** A membership row with the person behind it resolved for display. */
export type GroupMemberView = GroupMember & {
  profile: MemberProfile | null;
  /** True for the signed-in user's own row, which the UI labels "You". */
  isSelf: boolean;
};

/** A group in the user's list, with just enough context for a card. */
export type GroupSummary = Group & {
  /** The signed-in user's role in this group. */
  role: GroupRole;
  memberCount: number;
};

/**
 * An outstanding invitation as an admin sees it. Tokens are never included.
 *
 * Declined ones are listed alongside pending ones: an admin who cannot see that
 * somebody said no would re-invite them blindly.
 */
export type PendingInvitation = Omit<GroupInvitation, "token_hash"> & {
  inviterName: string | null;
  isExpired: boolean;
};

export type GroupDetail = {
  group: Group;
  /** The signed-in user's role. Every permission decision reads this. */
  role: GroupRole;
  isAdmin: boolean;
  members: GroupMemberView[];
  /** Only populated for admins — members cannot read a group's invitations. */
  invitations: PendingInvitation[];
};

/** Admins first, then longest-standing first, then by name. */
function byStanding(a: GroupMemberView, b: GroupMemberView): number {
  if (a.role !== b.role) {
    return a.role === "admin" ? -1 : 1;
  }

  if (a.joined_at !== b.joined_at) {
    return a.joined_at < b.joined_at ? -1 : 1;
  }

  return (a.profile?.name ?? "").localeCompare(b.profile?.name ?? "");
}

/**
 * Every group the user belongs to, most recently joined first.
 *
 * Three small queries rather than one nested select: memberships give the ids,
 * and the groups and the member counts follow from those. Each is indexed, and
 * none of them needs a relationship name to be disambiguated.
 */
export const listMyGroups = cache(async (): Promise<GroupSummary[]> => {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: memberships, error: membershipError } = await supabase
    .from("group_members")
    .select("group_id, role, joined_at")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: false });

  if (membershipError) {
    failed("listMemberships", membershipError.message);
  }

  const mine = memberships ?? [];

  if (mine.length === 0) {
    return [];
  }

  const groupIds = mine.map((membership) => membership.group_id);

  const [{ data: groups, error: groupError }, { data: allMembers, error: memberError }] =
    await Promise.all([
      supabase.from("groups").select(GROUP_COLUMNS).in("id", groupIds),
      supabase.from("group_members").select("group_id").in("group_id", groupIds),
    ]);

  if (groupError) {
    failed("listGroups", groupError.message);
  }

  if (memberError) {
    failed("listGroupMembers", memberError.message);
  }

  const counts = new Map<string, number>();

  for (const row of allMembers ?? []) {
    counts.set(row.group_id, (counts.get(row.group_id) ?? 0) + 1);
  }

  const byId = new Map((groups ?? []).map((group) => [group.id, group]));

  // Driven by the membership order, so the list reads newest-joined first and
  // a group that RLS withheld simply drops out.
  return mine.flatMap((membership) => {
    const group = byId.get(membership.group_id);

    if (!group) {
      return [];
    }

    return [
      {
        ...group,
        role: membership.role,
        memberCount: counts.get(group.id) ?? 1,
      },
    ];
  });
});

/**
 * One group with its members, or null when the user is not a member of it.
 *
 * Invitations are fetched only for admins. A member's own query would return
 * any invitation addressed to their email — correct per the policy, but not
 * something the group page should be showing them.
 */
export const getGroupDetail = cache(
  async (groupId: string): Promise<GroupDetail | null> => {
    const user = await requireUser();
    const supabase = await createClient();

    const { data: group, error: groupError } = await supabase
      .from("groups")
      .select(GROUP_COLUMNS)
      .eq("id", groupId)
      .maybeSingle();

    if (groupError) {
      failed("getGroup", groupError.message);
    }

    if (!group) {
      return null;
    }

    const { data: memberRows, error: memberError } = await supabase
      .from("group_members")
      .select(MEMBER_COLUMNS)
      .eq("group_id", groupId);

    if (memberError) {
      failed("getMembers", memberError.message);
    }

    const members = memberRows ?? [];
    const mine = members.find((member) => member.user_id === user.id);

    // Readable but not a member: only possible in the instant between creating
    // a group and its trigger claiming it. Treat it as not found.
    if (!mine) {
      return null;
    }

    const isAdmin = mine.role === "admin";

    const { data: profileRows, error: profileError } = await supabase
      .from("profiles")
      .select("id, name, email")
      .in(
        "id",
        members.map((member) => member.user_id),
      );

    if (profileError) {
      failed("getMemberProfiles", profileError.message);
    }

    const profiles = new Map(
      (profileRows ?? []).map((profile) => [profile.id, profile]),
    );

    const memberViews: GroupMemberView[] = members
      .map((member) => ({
        ...member,
        profile: profiles.get(member.user_id) ?? null,
        isSelf: member.user_id === user.id,
      }))
      .sort(byStanding);

    return {
      group,
      role: mine.role,
      isAdmin,
      members: memberViews,
      invitations: isAdmin
        ? await listPendingInvitations(groupId, profiles)
        : [],
    };
  },
);

async function listPendingInvitations(
  groupId: string,
  profiles: Map<string, MemberProfile>,
): Promise<PendingInvitation[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("group_invitations")
    .select(INVITATION_COLUMNS)
    .eq("group_id", groupId)
    .in("status", ["pending", "declined"])
    .order("created_at", { ascending: false });

  if (error) {
    failed("listInvitations", error.message);
  }

  const now = Date.now();

  return (data ?? []).map((invitation) => ({
    ...invitation,
    inviterName: invitation.invited_by
      ? (profiles.get(invitation.invited_by)?.name ?? null)
      : null,
    // Expiry is computed on read rather than written by a sweep: the insert
    // policy already refuses an expired invitation, so the status column would
    // only ever be catching up with what the clock already decided.
    isExpired: new Date(invitation.expires_at).getTime() <= now,
  }));
}

/** Whether a group has any expenses yet — the currency locks once it does. */
export async function groupHasExpenses(groupId: string): Promise<boolean> {
  const supabase = await createClient();

  const { count, error } = await supabase
    .from("expenses")
    .select("id", { count: "exact", head: true })
    .eq("group_id", groupId);

  if (error) {
    failed("countExpenses", error.message);
  }

  return (count ?? 0) > 0;
}

/**
 * An invitation as its recipient sees it, inside the application.
 *
 * Everything comes from `my_pending_invitations()`, which is scoped to the
 * signed-in user's own email address by the database.
 */
export type MyInvitation = {
  id: string;
  groupName: string;
  currencyCode: CurrencyCode;
  inviterName: string;
  role: GroupRole;
  expiresAt: string;
  createdAt: string;
};

/**
 * Open invitations addressed to the signed-in user.
 *
 * This is the in-app path: no token, no email, no link. `group_invitations`
 * already lets a user read rows addressed to their own email; the function only
 * adds the group's name and the inviter's, which the invitee cannot read
 * directly — `groups` requires membership, which is the rule that keeps an
 * invitation from leaking a group's contents.
 */
export const listMyInvitations = cache(async (): Promise<MyInvitation[]> => {
  await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("my_pending_invitations");

  if (error) {
    failed("listMyInvitations", error.message);
  }

  return (data ?? []).map((row) => ({
    id: row.invitation_id,
    groupName: row.group_name,
    currencyCode: row.currency_code,
    inviterName: row.inviter_name,
    role: row.invited_role,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));
});

/**
 * How many invitations are waiting, for the header's notification badge.
 *
 * Deliberately the same query as the inbox rather than a `count`: the layout
 * and the page render in one pass, so React's `cache()` makes this free, and
 * one definition of "waiting" cannot drift from the other.
 */
export async function countMyInvitations(): Promise<number> {
  return (await listMyInvitations()).length;
}

/**
 * What an invitation link may show the person holding it.
 *
 * Everything comes from `invitation_preview`, which is keyed by the token hash
 * and returns neither the group id nor the invited address in the clear.
 */
export type InvitationPreview = {
  groupName: string;
  currencyCode: CurrencyCode;
  inviterName: string;
  inviteeEmailMasked: string;
  role: GroupRole;
  status: InvitationStatus;
  expiresAt: string;
  isExpired: boolean;
  /** False when the link was addressed to a different account. */
  isForCurrentUser: boolean;
  isAlreadyMember: boolean;
};

export async function getInvitationPreview(
  token: string,
): Promise<InvitationPreview | null> {
  if (!isPlausibleToken(token)) {
    return null;
  }

  await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .rpc("invitation_preview", { p_token_hash: hashInvitationToken(token) })
    .maybeSingle();

  if (error) {
    failed("invitationPreview", error.message);
  }

  if (!data) {
    return null;
  }

  return {
    groupName: data.group_name,
    currencyCode: data.currency_code,
    inviterName: data.inviter_name,
    inviteeEmailMasked: data.invitee_email_masked,
    role: data.invited_role,
    status: data.invitation_status,
    expiresAt: data.expires_at,
    isExpired: new Date(data.expires_at).getTime() <= Date.now(),
    isForCurrentUser: data.is_for_current_user,
    isAlreadyMember: data.is_already_member,
  };
}
