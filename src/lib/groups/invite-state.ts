import type { FormState } from "@/lib/auth/form-state";

/**
 * State returned by `inviteMember`.
 *
 * It lives here rather than beside the action because a `"use server"` module
 * may only export async functions — a shared constant has to come from a
 * plain module.
 */

/** How the invitation email fared, so the UI can offer the right next step. */
export type InviteDelivery = "sent" | "not_configured" | "failed";

export type InviteFormState = FormState & {
  invite?: {
    email: string;
    delivery: InviteDelivery;
    /**
     * The one-time link, returned only when the email did not go out. The
     * token is never stored in the clear, so this is the single moment it can
     * be handed over — after this response it exists nowhere but the admin's
     * screen.
     */
    link?: string;
  };
};

export const idleInviteState: InviteFormState = { status: "idle" };
