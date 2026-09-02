import "server-only";

import type { AuthError } from "@supabase/supabase-js";

/**
 * Translates Supabase auth failures into messages that are safe and useful to
 * show a user. Anything unrecognised falls back to a generic message so raw
 * provider errors never reach the browser; the original is logged instead.
 */
export function authErrorMessage(error: AuthError, context: string): string {
  // Full detail stays server-side for debugging.
  console.error(`[auth:${context}]`, {
    name: error.name,
    status: error.status,
    code: error.code,
    message: error.message,
  });

  switch (error.code) {
    case "invalid_credentials":
      return "That email and password combination doesn't match an account.";
    case "email_not_confirmed":
      return "Please confirm your email address first — check your inbox for the link.";
    case "user_already_exists":
    case "email_exists":
      return "An account with this email already exists. Try signing in instead.";
    case "weak_password":
      return "Please choose a stronger password.";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "Too many attempts. Please wait a moment and try again.";
    case "otp_expired":
      return "That link has expired. Request a new one and try again.";
    case "signup_disabled":
      return "New sign ups are currently disabled.";
    case "validation_failed":
      return "Please check the details you entered and try again.";
    default:
      return "Something went wrong. Please try again.";
  }
}

/** Generic message for non-auth failures (network, database, unexpected). */
export function unexpectedErrorMessage(
  error: unknown,
  context: string,
): string {
  console.error(`[${context}]`, error);
  return "Something went wrong. Please try again.";
}
