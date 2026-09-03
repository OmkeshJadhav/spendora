import "server-only";

import { createResendProvider } from "@/lib/email/resend";
import type { EmailMessage, EmailProvider, EmailResult } from "@/lib/email/types";
import { getEmailEnv } from "@/lib/env";

export type { EmailMessage, EmailResult } from "@/lib/email/types";

/**
 * The application's one way to send email.
 *
 * Sending is server-side only — the API key must never reach the browser
 * (specification section 12) — and the provider is chosen here, so no caller
 * knows which one is in use.
 */

function resolveProvider(): EmailProvider | null {
  const env = getEmailEnv();

  return env ? createResendProvider(env) : null;
}

export function isEmailConfigured(): boolean {
  return getEmailEnv() !== null;
}

/**
 * Sends a message, or reports why it could not be sent.
 *
 * Never throws and never returns provider detail to the caller: failures are
 * logged here and described to the user in the caller's own words, so a
 * bounced invitation cannot take down the action that triggered it.
 */
export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const provider = resolveProvider();

  if (!provider) {
    console.warn(
      "[email] No provider configured (EMAIL_API_KEY / EMAIL_FROM). Message not sent:",
      message.subject,
    );
    return { status: "not_configured" };
  }

  const result = await provider.send(message);

  if (result.status === "failed") {
    console.error(`[email:${result.provider}]`, result.reason);
  }

  return result;
}
