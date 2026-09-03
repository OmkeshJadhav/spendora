import "server-only";

import type { EmailEnv } from "@/lib/env";
import type { EmailMessage, EmailProvider, EmailResult } from "@/lib/email/types";

/**
 * Resend, over its HTTP API.
 *
 * Chosen for its free tier and for needing nothing but `fetch` — a whole SDK
 * for one POST would be the kind of dependency specification section 3 asks us
 * not to add. The API key is read from the server environment and never leaves
 * this module.
 */

const ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

export function createResendProvider(env: EmailEnv): EmailProvider {
  return {
    name: "resend",
    async send(message: EmailMessage): Promise<EmailResult> {
      try {
        const response = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            authorization: `Bearer ${env.EMAIL_API_KEY}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            from: env.EMAIL_FROM,
            to: [message.to],
            subject: message.subject,
            html: message.html,
            text: message.text,
          }),
          // A slow provider must not hold a Server Action open indefinitely.
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (!response.ok) {
          // Read the body for the log, but never surface it to a user.
          const detail = await response.text().catch(() => "");
          return {
            status: "failed",
            provider: "resend",
            reason: `HTTP ${response.status} ${detail.slice(0, 300)}`.trim(),
          };
        }

        const body: unknown = await response.json().catch(() => null);
        const id =
          body && typeof body === "object" && "id" in body
            ? String((body as { id: unknown }).id)
            : null;

        return { status: "sent", provider: "resend", id };
      } catch (error) {
        return {
          status: "failed",
          provider: "resend",
          reason: error instanceof Error ? error.message : "unknown error",
        };
      }
    },
  };
}
