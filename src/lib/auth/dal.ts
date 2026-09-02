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

/**
 * The authenticated user, or null.
 *
 * Uses `getUser()` rather than `getSession()`: it revalidates the token with
 * the Supabase Auth server instead of trusting the cookie's contents.
 */
export const getUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user ?? null;
});

/** The user, or a redirect to sign in. Use this to gate a protected page. */
export async function requireUser(): Promise<User> {
  const user = await getUser();

  if (!user) {
    redirect(SIGN_IN_PATH);
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
