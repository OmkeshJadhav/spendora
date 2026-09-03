/**
 * The provider-independent surface of the email service.
 *
 * Everything the application sends is described in these terms, so replacing
 * Resend with Brevo or Mailjet is one new file plus one line in `index.ts`
 * (specification section 12).
 */

export type EmailMessage = {
  to: string;
  subject: string;
  /** Always send both parts: some clients, and most spam filters, want text. */
  html: string;
  text: string;
};

export type EmailResult =
  /** The provider accepted the message. */
  | { status: "sent"; provider: string; id: string | null }
  /** No provider is configured. Not an error — the caller offers a fallback. */
  | { status: "not_configured" }
  /** The provider rejected it, or could not be reached. */
  | { status: "failed"; provider: string; reason: string };

export type EmailProvider = {
  name: string;
  send(message: EmailMessage): Promise<EmailResult>;
};
