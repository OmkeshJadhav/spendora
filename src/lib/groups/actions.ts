"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";

import { getProfile, getUser } from "@/lib/auth/dal";
import { unexpectedErrorMessage } from "@/lib/auth/errors";
import type { FormState } from "@/lib/auth/form-state";
import { sendEmail } from "@/lib/email";
import { groupInvitationEmail } from "@/lib/email/templates/group-invitation";
import { withFlash } from "@/lib/flash";
import type { InviteFormState } from "@/lib/groups/invite-state";
import {
  createInvitationToken,
  hashInvitationToken,
  invitationExpiresAt,
  isPlausibleToken,
} from "@/lib/groups/tokens";
import { getSiteOrigin } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";
import {
  createGroupSchema,
  inviteMemberSchema,
  memberRoleSchema,
  updateGroupSchema,
} from "@/lib/validations/group";
import type { GroupRole } from "@/types";
import type { Database } from "@/types/database";

/**
 * Group, membership and invitation mutations.
 *
 * Server Actions are public POST endpoints, so each one re-validates its input
 * and re-derives the user from the session. Group ids arrive from the client —
 * they have to, since the client is what says which group to act on — but
 * nothing is trusted about the *right* to act on one: every write below is
 * refused by RLS unless the session's user is an admin of that group, or is
 * acting on their own membership. The messages here explain a refusal; they
 * are not what causes it.
 */

const GROUPS_PATH = "/groups";
const INVITATIONS_PATH = "/invitations";

type Client = SupabaseClient<Database>;

function groupPath(groupId: string): string {
  return `${GROUPS_PATH}/${groupId}`;
}

function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    (fieldErrors[key] ??= []).push(issue.message);
  }

  return fieldErrors;
}

const SESSION_EXPIRED: FormState = {
  status: "error",
  message: "Your session has expired. Please sign in again.",
};

/** Refreshes the group page and the list that summarises it. */
function revalidateGroup(groupId: string): void {
  revalidatePath(GROUPS_PATH);
  revalidatePath(groupPath(groupId));
  revalidatePath(`${groupPath(groupId)}/settings`);
}

/**
 * Maps a database rejection to copy a user can act on.
 *
 * `42501` is RLS refusing the write, which for these tables always means the
 * same thing: the user is not an admin of this group (or no longer a member of
 * it at all).
 */
function writeFailureMessage(
  code: string | undefined,
  message: string,
  context: string,
): string {
  console.error(`[groups:${context}]`, { code, message });

  switch (code) {
    case "42501":
      return "You don't have permission to do that. Only a group admin can.";
    case "23514":
      // The last-admin trigger raises this. Its own message is ours, written
      // for a person, so it is safe and more useful than a generic line.
      return message.includes("at least one admin")
        ? "A group must keep at least one admin. Make someone else an admin first, or delete the group."
        : "Those details were rejected. Please check them and try again.";
    case "23503":
      return "That change can't be applied because other records depend on it.";
    case "23505":
      return "That already exists.";
    default:
      return "We couldn't save that change. Please try again.";
  }
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

function readGroupForm(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    currencyCode: String(formData.get("currencyCode") ?? ""),
  };
}

export async function createGroup(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const raw = readGroupForm(formData);
  const parsed = createGroupSchema.safeParse(raw);

  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: fieldErrorsOf(parsed.error),
      values: raw,
    };
  }

  let groupId: string;

  try {
    const user = await getUser();

    if (!user) {
      return SESSION_EXPIRED;
    }

    const supabase = await createClient();

    const { data, error } = await supabase
      .from("groups")
      .insert({
        name: parsed.data.name,
        description: parsed.data.description,
        currency_code: parsed.data.currencyCode,
        // The session's user, never the form's: the insert policy requires the
        // two to agree, and a trigger then makes them the admin.
        created_by: user.id,
      })
      .select("id")
      .single();

    if (error) {
      return {
        status: "error",
        message: writeFailureMessage(error.code, error.message, "create"),
        values: raw,
      };
    }

    groupId = data.id;
  } catch (error) {
    return {
      status: "error",
      message: unexpectedErrorMessage(error, "groups:create"),
      values: raw,
    };
  }

  revalidatePath(GROUPS_PATH);
  // redirect() throws to unwind, so it must sit outside the try block.
  redirect(withFlash(groupPath(groupId), "group-created"));
}

export async function updateGroup(
  groupId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const raw = readGroupForm(formData);
  const parsed = updateGroupSchema.safeParse(raw);

  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: fieldErrorsOf(parsed.error),
      values: raw,
    };
  }

  try {
    const user = await getUser();

    if (!user) {
      return SESSION_EXPIRED;
    }

    const supabase = await createClient();

    const { data, error } = await supabase
      .from("groups")
      .update({
        name: parsed.data.name,
        description: parsed.data.description,
        currency_code: parsed.data.currencyCode,
      })
      .eq("id", groupId)
      .select("id");

    if (error) {
      // A group's currency is referenced by every expense recorded in it, with
      // `on update restrict`. Changing it afterwards would silently reprice
      // history, so the database refuses (specification section 10).
      if (error.code === "23503") {
        console.error("[groups:update]", error.message);
        return {
          status: "error",
          message:
            "This group's currency can't be changed once expenses have been recorded in it.",
          fieldErrors: { currencyCode: ["Locked by existing expenses"] },
          values: raw,
        };
      }

      return {
        status: "error",
        message: writeFailureMessage(error.code, error.message, "update"),
        values: raw,
      };
    }

    if (!data || data.length === 0) {
      return {
        status: "error",
        message: "You don't have permission to edit this group.",
        values: raw,
      };
    }
  } catch (error) {
    return {
      status: "error",
      message: unexpectedErrorMessage(error, "groups:update"),
      values: raw,
    };
  }

  revalidateGroup(groupId);
  redirect(withFlash(`${groupPath(groupId)}/settings`, "group-updated"));
}

export async function deleteGroup(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const groupId = String(formData.get("groupId") ?? "");

  if (!groupId) {
    return { status: "error", message: "That group no longer exists." };
  }

  try {
    const user = await getUser();

    if (!user) {
      return SESSION_EXPIRED;
    }

    const supabase = await createClient();

    const { data, error } = await supabase
      .from("groups")
      .delete()
      .eq("id", groupId)
      .select("id");

    if (error) {
      return {
        status: "error",
        message: writeFailureMessage(error.code, error.message, "delete"),
      };
    }

    if (!data || data.length === 0) {
      return {
        status: "error",
        message: "You don't have permission to delete this group.",
      };
    }
  } catch (error) {
    return {
      status: "error",
      message: unexpectedErrorMessage(error, "groups:delete"),
    };
  }

  revalidatePath(GROUPS_PATH);
  redirect(withFlash(GROUPS_PATH, "group-deleted"));
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export async function updateMemberRole(
  groupId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = memberRoleSchema.safeParse({
    memberId: String(formData.get("memberId") ?? ""),
    role: String(formData.get("role") ?? ""),
  });

  if (!parsed.success) {
    return { status: "error", message: "That change could not be applied." };
  }

  try {
    const user = await getUser();

    if (!user) {
      return SESSION_EXPIRED;
    }

    const supabase = await createClient();

    const { data, error } = await supabase
      .from("group_members")
      .update({ role: parsed.data.role })
      .eq("id", parsed.data.memberId)
      // Scoped to the group whose page this was submitted from, so a member id
      // from another group cannot be smuggled in through the form.
      .eq("group_id", groupId)
      .select("id");

    if (error) {
      return {
        status: "error",
        message: writeFailureMessage(error.code, error.message, "updateRole"),
      };
    }

    if (!data || data.length === 0) {
      return {
        status: "error",
        message: "That member is no longer in this group.",
      };
    }
  } catch (error) {
    return {
      status: "error",
      message: unexpectedErrorMessage(error, "groups:updateRole"),
    };
  }

  revalidateGroup(groupId);

  return { status: "success", message: "Role updated." };
}

export async function removeMember(
  groupId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const memberId = String(formData.get("memberId") ?? "");

  if (!memberId) {
    return { status: "error", message: "That member could not be found." };
  }

  try {
    const user = await getUser();

    if (!user) {
      return SESSION_EXPIRED;
    }

    const supabase = await createClient();

    const { data, error } = await supabase
      .from("group_members")
      .delete()
      .eq("id", memberId)
      .eq("group_id", groupId)
      .select("id");

    if (error) {
      return {
        status: "error",
        message: writeFailureMessage(error.code, error.message, "removeMember"),
      };
    }

    if (!data || data.length === 0) {
      return {
        status: "error",
        message: "That member is no longer in this group.",
      };
    }
  } catch (error) {
    return {
      status: "error",
      message: unexpectedErrorMessage(error, "groups:removeMember"),
    };
  }

  revalidateGroup(groupId);
  redirect(withFlash(groupPath(groupId), "member-removed"));
}

/**
 * Leaving a group.
 *
 * The delete policy lets anyone remove their own membership, and the
 * last-admin trigger is what stops a sole admin from orphaning the group —
 * they are told to appoint someone else or delete it instead.
 */
export async function leaveGroup(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const groupId = String(formData.get("groupId") ?? "");

  if (!groupId) {
    return { status: "error", message: "That group no longer exists." };
  }

  try {
    const user = await getUser();

    if (!user) {
      return SESSION_EXPIRED;
    }

    const supabase = await createClient();

    const { data, error } = await supabase
      .from("group_members")
      .delete()
      .eq("group_id", groupId)
      // Identity comes from the session, so this can only ever remove yourself.
      .eq("user_id", user.id)
      .select("id");

    if (error) {
      return {
        status: "error",
        message: writeFailureMessage(error.code, error.message, "leave"),
      };
    }

    if (!data || data.length === 0) {
      return {
        status: "error",
        message: "You're no longer a member of this group.",
      };
    }
  } catch (error) {
    return {
      status: "error",
      message: unexpectedErrorMessage(error, "groups:leave"),
    };
  }

  revalidatePath(GROUPS_PATH);
  redirect(withFlash(GROUPS_PATH, "group-left"));
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

export async function inviteMember(
  groupId: string,
  _prevState: InviteFormState,
  formData: FormData,
): Promise<InviteFormState> {
  const raw = {
    email: String(formData.get("email") ?? ""),
    role: String(formData.get("role") ?? "member"),
  };
  const parsed = inviteMemberSchema.safeParse(raw);

  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: fieldErrorsOf(parsed.error),
      values: raw,
    };
  }

  const { email, role } = parsed.data;

  try {
    const profile = await getProfile();

    if (!profile) {
      return SESSION_EXPIRED;
    }

    if (email === profile.email.toLowerCase()) {
      return {
        status: "error",
        message: "You're already in this group.",
        fieldErrors: { email: ["This is your own address"] },
        values: raw,
      };
    }

    const supabase = await createClient();

    // Only an admin can read a group's invitations, so this doubles as the
    // permission check that produces a useful message before the insert.
    const { data: existing, error: existingError } = await supabase
      .from("group_invitations")
      .select("id, expires_at")
      .eq("group_id", groupId)
      .eq("email", email)
      .eq("status", "pending")
      .maybeSingle();

    if (existingError) {
      return {
        status: "error",
        message: writeFailureMessage(
          existingError.code,
          existingError.message,
          "checkInvitation",
        ),
        values: raw,
      };
    }

    if (existing && new Date(existing.expires_at).getTime() > Date.now()) {
      return {
        status: "error",
        message: `${email} already has a pending invitation to this group.`,
        fieldErrors: { email: ["Already invited"] },
        values: raw,
      };
    }

    // An expired invitation still occupies the "one pending per email" slot.
    // Retire it so a fresh one can be issued.
    if (existing) {
      const { error: expireError } = await supabase
        .from("group_invitations")
        .update({ status: "expired" })
        .eq("id", existing.id);

      if (expireError) {
        return {
          status: "error",
          message: writeFailureMessage(
            expireError.code,
            expireError.message,
            "expireInvitation",
          ),
          values: raw,
        };
      }
    }

    const { token, tokenHash } = createInvitationToken();
    const expiresAt = invitationExpiresAt();

    const { data: invitation, error } = await supabase
      .from("group_invitations")
      .insert({
        group_id: groupId,
        email,
        role,
        token_hash: tokenHash,
        invited_by: profile.id,
        status: "pending",
        expires_at: expiresAt.toISOString(),
      })
      .select("id, group_id")
      .single();

    if (error) {
      // The normalise trigger raises a unique violation when the address
      // already belongs to a member, and the partial index raises one when an
      // invitation is already outstanding. Either way the answer is the same.
      if (error.code === "23505") {
        console.error("[groups:invite]", error.message);
        return {
          status: "error",
          message: `${email} is already a member of this group, or has already been invited.`,
          fieldErrors: { email: ["Already invited or a member"] },
          values: raw,
        };
      }

      return {
        status: "error",
        message: writeFailureMessage(error.code, error.message, "invite"),
        values: raw,
      };
    }

    // Read the group name for the email. This is an admin, so RLS allows it.
    const { data: group } = await supabase
      .from("groups")
      .select("name")
      .eq("id", invitation.group_id)
      .maybeSingle();

    const origin = await getSiteOrigin();
    const link = `${origin}/invite/${token}`;

    const result = await sendEmail(
      groupInvitationEmail({
        to: email,
        groupName: group?.name ?? "a group",
        inviterName: profile.name,
        acceptUrl: link,
        expiresAt,
        role,
      }),
    );

    revalidateGroup(groupId);

    if (result.status === "sent") {
      return {
        status: "success",
        message: `${email} has been invited. It's waiting in their Spendora invitations, and we emailed them too.`,
        invite: { email, delivery: "sent" },
      };
    }

    // The invitation is real either way — only the delivery failed. Hand the
    // link back so the admin can pass it on themselves rather than being left
    // with an invitation nobody can find.
    return {
      status: "success",
      message:
        result.status === "not_configured"
          ? `${email} has been invited. It's waiting in their Spendora invitations — if they don't have an account yet, send them this link.`
          : `${email} has been invited. It's waiting in their Spendora invitations, but the email couldn't be delivered — if they don't have an account yet, send them this link.`,
      invite: { email, delivery: result.status, link },
    };
  } catch (error) {
    return {
      status: "error",
      message: unexpectedErrorMessage(error, "groups:invite"),
      values: raw,
    };
  }
}

export async function revokeInvitation(
  groupId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const invitationId = String(formData.get("invitationId") ?? "");

  if (!invitationId) {
    return { status: "error", message: "That invitation no longer exists." };
  }

  try {
    const user = await getUser();

    if (!user) {
      return SESSION_EXPIRED;
    }

    const supabase = await createClient();

    const { data, error } = await supabase
      .from("group_invitations")
      .update({ status: "revoked" })
      .eq("id", invitationId)
      .eq("group_id", groupId)
      .eq("status", "pending")
      .select("id");

    if (error) {
      return {
        status: "error",
        message: writeFailureMessage(error.code, error.message, "revoke"),
      };
    }

    if (!data || data.length === 0) {
      return {
        status: "error",
        message: "That invitation has already been used or withdrawn.",
      };
    }
  } catch (error) {
    return {
      status: "error",
      message: unexpectedErrorMessage(error, "groups:revoke"),
    };
  }

  revalidateGroup(groupId);
  redirect(withFlash(groupPath(groupId), "invitation-revoked"));
}

/**
 * Joining a group against an invitation the database has already approved of.
 *
 * There is no privileged path here, and deliberately no token check either:
 * `group_members_insert_admin_or_invitee` allows the insert only when a
 * pending, unexpired invitation addressed to *this user's own email* exists for
 * that group — and only in the role that invitation grants. Whether the user
 * arrived from a link or from their in-app inbox makes no difference to what
 * the database will accept.
 *
 * Returns the group joined, or a message to show. A trigger then marks the
 * invitation accepted.
 */
async function joinAgainstInvitation(
  supabase: Client,
  userId: string,
  invitation: { group_id: string; role: GroupRole; status: string; expires_at: string },
): Promise<{ groupId: string; alreadyMember: boolean } | FormState> {
  if (invitation.status !== "pending") {
    return {
      status: "error",
      message: "That invitation has already been used or withdrawn.",
    };
  }

  if (new Date(invitation.expires_at).getTime() <= Date.now()) {
    return {
      status: "error",
      message: "That invitation has expired. Ask the group admin for a new one.",
    };
  }

  const { error } = await supabase.from("group_members").insert({
    group_id: invitation.group_id,
    // From the session, never the form.
    user_id: userId,
    // From the invitation, never the form: the policy insists they match.
    role: invitation.role,
  });

  if (error) {
    if (error.code === "23505") {
      return { groupId: invitation.group_id, alreadyMember: true };
    }

    return {
      status: "error",
      message: writeFailureMessage(error.code, error.message, "accept"),
    };
  }

  return { groupId: invitation.group_id, alreadyMember: false };
}

const INVITATION_LOOKUP_COLUMNS = "group_id, role, expires_at, status";

/** Not valid, or addressed to somebody else — the same answer either way. */
const INVITATION_NOT_FOUND: FormState = {
  status: "error",
  message:
    "That invitation is no longer valid, or it was sent to a different email address.",
};

/**
 * Accepting from the in-app invitations list.
 *
 * The invitation id comes from the client, which is fine: RLS only lets a user
 * read — and therefore only lets this find — an invitation addressed to their
 * own email. An id belonging to somebody else simply does not resolve.
 */
export async function acceptInvitation(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const invitationId = String(formData.get("invitationId") ?? "");

  if (!invitationId) {
    return INVITATION_NOT_FOUND;
  }

  let joined: { groupId: string; alreadyMember: boolean };

  try {
    const user = await getUser();

    if (!user) {
      return SESSION_EXPIRED;
    }

    const supabase = await createClient();

    const { data: invitation, error } = await supabase
      .from("group_invitations")
      .select(INVITATION_LOOKUP_COLUMNS)
      .eq("id", invitationId)
      .maybeSingle();

    if (error) {
      return {
        status: "error",
        message: writeFailureMessage(error.code, error.message, "acceptLookup"),
      };
    }

    if (!invitation) {
      return INVITATION_NOT_FOUND;
    }

    const result = await joinAgainstInvitation(supabase, user.id, invitation);

    if ("status" in result) {
      return result;
    }

    joined = result;
  } catch (error) {
    return {
      status: "error",
      message: unexpectedErrorMessage(error, "groups:accept"),
    };
  }

  revalidatePath(GROUPS_PATH);
  revalidatePath(INVITATIONS_PATH);
  revalidatePath(groupPath(joined.groupId));
  redirect(
    withFlash(
      groupPath(joined.groupId),
      joined.alreadyMember ? "already-a-member" : "invitation-accepted",
    ),
  );
}

/**
 * Accepting from an emailed link.
 *
 * Identical once the invitation is found; only the way of finding it differs.
 * The link exists for people who did not have an account when they were
 * invited, and so have no in-app inbox to find it in.
 */
export async function acceptInvitationByToken(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const token = String(formData.get("token") ?? "");

  if (!isPlausibleToken(token)) {
    return { status: "error", message: "That invitation link is not valid." };
  }

  let joined: { groupId: string; alreadyMember: boolean };

  try {
    const user = await getUser();

    if (!user) {
      return SESSION_EXPIRED;
    }

    const supabase = await createClient();

    // Readable only by the addressee (or an admin), so this is already the
    // "is this invitation mine?" check.
    const { data: invitation, error } = await supabase
      .from("group_invitations")
      .select(INVITATION_LOOKUP_COLUMNS)
      .eq("token_hash", hashInvitationToken(token))
      .maybeSingle();

    if (error) {
      return {
        status: "error",
        message: writeFailureMessage(error.code, error.message, "acceptLookup"),
      };
    }

    if (!invitation) {
      return INVITATION_NOT_FOUND;
    }

    const result = await joinAgainstInvitation(supabase, user.id, invitation);

    if ("status" in result) {
      return result;
    }

    joined = result;
  } catch (error) {
    return {
      status: "error",
      message: unexpectedErrorMessage(error, "groups:acceptByToken"),
    };
  }

  revalidatePath(GROUPS_PATH);
  revalidatePath(INVITATIONS_PATH);
  revalidatePath(groupPath(joined.groupId));
  redirect(
    withFlash(
      groupPath(joined.groupId),
      joined.alreadyMember ? "already-a-member" : "invitation-accepted",
    ),
  );
}

/**
 * Declining an invitation.
 *
 * `group_invitations_decline_invitee` permits exactly one transition —
 * `pending → declined`, on a row addressed to the caller's own email — and the
 * pinning trigger resets `role` and `expires_at` for anyone who is not an admin
 * of that group, so a crafted form cannot promote itself on the way out.
 *
 * Declining frees the "one pending invitation per email" slot, so an admin can
 * invite the same person again.
 */
export async function declineInvitation(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const invitationId = String(formData.get("invitationId") ?? "");

  if (!invitationId) {
    return INVITATION_NOT_FOUND;
  }

  try {
    const user = await getUser();

    if (!user) {
      return SESSION_EXPIRED;
    }

    const supabase = await createClient();

    const { data, error } = await supabase
      .from("group_invitations")
      .update({ status: "declined" })
      .eq("id", invitationId)
      .eq("status", "pending")
      .select("id");

    if (error) {
      return {
        status: "error",
        message: writeFailureMessage(error.code, error.message, "decline"),
      };
    }

    if (!data || data.length === 0) {
      return INVITATION_NOT_FOUND;
    }
  } catch (error) {
    return {
      status: "error",
      message: unexpectedErrorMessage(error, "groups:decline"),
    };
  }

  revalidatePath(INVITATIONS_PATH);
  redirect(withFlash(INVITATIONS_PATH, "invitation-declined"));
}

/**
 * Removing an invitation that is already closed — declined, revoked or expired
 * — from the group's list. Admin only, and never a way to withdraw an open one:
 * that is what `revokeInvitation` is for, and it leaves a record.
 */
export async function dismissInvitation(
  groupId: string,
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const invitationId = String(formData.get("invitationId") ?? "");

  if (!invitationId) {
    return { status: "error", message: "That invitation no longer exists." };
  }

  try {
    const user = await getUser();

    if (!user) {
      return SESSION_EXPIRED;
    }

    const supabase = await createClient();

    const { data, error } = await supabase
      .from("group_invitations")
      .delete()
      .eq("id", invitationId)
      .eq("group_id", groupId)
      .neq("status", "pending")
      .select("id");

    if (error) {
      return {
        status: "error",
        message: writeFailureMessage(error.code, error.message, "dismiss"),
      };
    }

    if (!data || data.length === 0) {
      return {
        status: "error",
        message: "That invitation is still open. Revoke it instead.",
      };
    }
  } catch (error) {
    return {
      status: "error",
      message: unexpectedErrorMessage(error, "groups:dismiss"),
    };
  }

  revalidateGroup(groupId);
  redirect(withFlash(groupPath(groupId), "invitation-dismissed"));
}
