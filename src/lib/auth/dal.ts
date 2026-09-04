import "server-only";

import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types/database";

/**
 * Data access layer for the signed-in user.
 *
 * Every read of the current user goes through here so the session check can
 * never be forgotten at a call site. Results are memoised per render pass, so
 * a layout and its pages share one lookup.
 */

export const SIGN_IN_PATH = "/sign-in";

/** Where an unconfirmed account is sent, with copy explaining why. */
const UNCONFIRMED_PATH = `${SIGN_IN_PATH}?error=email_not_confirmed`;

/**
 * Whether the account's email address has actually been verified.
 *
 * Supabase's "Confirm email" setting is what sends the link and withholds the
 * session, but the check is repeated here so the application never depends on
 * a dashboard toggle alone: a session belonging to an unverified address is
 * worth nothing to it. This matters because group membership is granted by
 * email address — an unverified address must not be able to accept an
 * invitation addressed to someone else.
 */
export function hasConfirmedEmail(user: User): boolean {
  return Boolean(user.email_confirmed_at);
}

/**
 * Whoever the session belongs to, confirmed or not — the single auth-server
 * round trip everything else in this file shares.
 *
 * Uses `getUser()` rather than `getSession()`: it revalidates the token with
 * the Supabase Auth server instead of trusting the cookie's contents. Not
 * exported, because callers should be going through one of the two gates
 * below rather than deciding for themselves what an unconfirmed user may do.
 */
const getAuthUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user ?? null;
});

/**
 * The authenticated user, or null. An account whose email address has not been
 * confirmed counts as signed out.
 */
export const getUser = cache(async (): Promise<User | null> => {
  const user = await getAuthUser();

  return user && hasConfirmedEmail(user) ? user : null;
});

/** The user, or a redirect to sign in. Use this to gate a protected page. */
export async function requireUser(): Promise<User> {
  const user = await getAuthUser();

  if (!user) {
    redirect(SIGN_IN_PATH);
  }

  // A real session, but for an address nobody has proved they own. Kept
  // separate from "signed out" so the sign-in page can say what went wrong.
  if (!hasConfirmedEmail(user)) {
    redirect(UNCONFIRMED_PATH);
  }

  return user;
}

/** The signed-in user's profile row, or null if there is no session. */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const user = await getUser();

  if (!user) {
    return null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name, email, created_at, updated_at")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[dal:getProfile]", error.message);
    return null;
  }

  return data;
});

/**
 * The profile of the signed-in user, or a redirect.
 *
 * A signed-in user without a profile row means the sign-up trigger did not run
 * — surfaced loudly rather than papered over with a placeholder name.
 */
export async function requireProfile(): Promise<Profile> {
  await requireUser();
  const profile = await getProfile();

  if (!profile) {
    throw new Error("Signed-in user has no profile row.");
  }

  return profile;
}
