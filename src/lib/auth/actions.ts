"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { z } from "zod";

import { authErrorMessage, unexpectedErrorMessage } from "@/lib/auth/errors";
import type { FormState } from "@/lib/auth/form-state";
import { getUser } from "@/lib/auth/dal";
import { safeRedirectPath } from "@/lib/auth/redirects";
import { getSiteOrigin } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";
import {
  signInSchema,
  signUpSchema,
  updateProfileSchema,
} from "@/lib/validations/auth";

/**
 * Server Actions are public POST endpoints, so each one re-validates its input
 * and re-derives the user from the session rather than trusting the form.
 */

function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    (fieldErrors[key] ??= []).push(issue.message);
  }

  return fieldErrors;
}

export async function signUp(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const raw = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  };
  const echo = { name: raw.name, email: raw.email };
  // An invitation link sends people here to create an account first; this is
  // what carries them back to it afterwards.
  const destination = safeRedirectPath(
    formData.get("next") ? String(formData.get("next")) : null,
  );

  const parsed = signUpSchema.safeParse(raw);

  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: fieldErrorsOf(parsed.error),
      values: echo,
    };
  }

  const { name, email, password } = parsed.data;

  let hasSession = false;

  try {
    const supabase = await createClient();
    const origin = await getSiteOrigin();

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Read by the sign-up trigger to seed profiles.name.
        data: { name },
        emailRedirectTo: `${origin}/auth/confirm`,
      },
    });

    if (error) {
      return {
        status: "error",
        message: authErrorMessage(error, "signUp"),
        values: echo,
      };
    }

    // With email confirmation enabled, Supabase returns a user but no session.
    hasSession = Boolean(data.session);

    if (!hasSession) {
      return {
        status: "success",
        message: `Almost there — confirm your email. We sent a link to ${email}.`,
        values: echo,
      };
    }
  } catch (error) {
    return {
      status: "error",
      message: unexpectedErrorMessage(error, "auth:signUp"),
      values: echo,
    };
  }

  // redirect() throws to unwind, so it must sit outside the try block.
  revalidatePath("/", "layout");
  redirect(destination);
}

export async function signIn(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const raw = {
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  };
  const echo = { email: raw.email };
  const destination = safeRedirectPath(
    formData.get("next") ? String(formData.get("next")) : null,
  );

  const parsed = signInSchema.safeParse(raw);

  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: fieldErrorsOf(parsed.error),
      values: echo,
    };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword(parsed.data);

    if (error) {
      return {
        status: "error",
        message: authErrorMessage(error, "signIn"),
        values: echo,
      };
    }
  } catch (error) {
    return {
      status: "error",
      message: unexpectedErrorMessage(error, "auth:signIn"),
      values: echo,
    };
  }

  revalidatePath("/", "layout");
  redirect(destination);
}

export async function signOut(): Promise<void> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut();

    if (error) {
      authErrorMessage(error, "signOut");
    }
  } catch (error) {
    unexpectedErrorMessage(error, "auth:signOut");
  }

  revalidatePath("/", "layout");
  redirect("/sign-in");
}

export async function updateProfileName(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const raw = { name: String(formData.get("name") ?? "") };

  const parsed = updateProfileSchema.safeParse(raw);

  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: fieldErrorsOf(parsed.error),
      values: raw,
    };
  }

  try {
    // Identity comes from the session, never from the submitted form.
    const user = await getUser();

    if (!user) {
      return {
        status: "error",
        message: "Your session has expired. Please sign in again.",
      };
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ name: parsed.data.name })
      .eq("id", user.id);

    if (error) {
      console.error("[profile:updateName]", error.message);
      return {
        status: "error",
        message: "We couldn't save your name. Please try again.",
        values: raw,
      };
    }
  } catch (error) {
    return {
      status: "error",
      message: unexpectedErrorMessage(error, "profile:updateName"),
      values: raw,
    };
  }

  revalidatePath("/", "layout");

  return { status: "success", message: "Your name has been updated." };
}
