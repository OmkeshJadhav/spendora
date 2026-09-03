import type { EmailMessage } from "@/lib/email/types";
import { APP_NAME } from "@/lib/constants";

/**
 * The group invitation email (specification section 11): group name, inviter
 * name, the link, and when it stops working.
 *
 * Written as inline-styled HTML with a plain-text twin. Email clients strip
 * stylesheets, and every value that comes from a person — a group name, a
 * display name — is escaped, because this is a document assembled from
 * untrusted strings just like any page.
 */

export type GroupInvitationEmail = {
  to: string;
  groupName: string;
  inviterName: string;
  acceptUrl: string;
  expiresAt: Date;
  /** Wording differs: joining as an admin is not the same offer. */
  role: "admin" | "member";
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatExpiry(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

export function groupInvitationEmail({
  to,
  groupName,
  inviterName,
  acceptUrl,
  expiresAt,
  role,
}: GroupInvitationEmail): EmailMessage {
  const expiry = `${formatExpiry(expiresAt)} UTC`;
  const asRole = role === "admin" ? "an admin" : "a member";

  const subject = `${inviterName} invited you to “${groupName}” on ${APP_NAME}`;

  const text = [
    `${inviterName} has invited you to join the group “${groupName}” on ${APP_NAME} as ${asRole}.`,
    "",
    "Accept the invitation:",
    acceptUrl,
    "",
    `This link expires on ${expiry}, and only works for ${to}.`,
    "",
    "If you weren't expecting this invitation, you can ignore this email.",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1b1d21;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:28px;">
      <p style="margin:0 0 20px;font-size:14px;font-weight:600;color:#4f46e5;">${escapeHtml(APP_NAME)}</p>

      <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;font-weight:600;">
        You've been invited to “${escapeHtml(groupName)}”
      </h1>

      <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4b5563;">
        ${escapeHtml(inviterName)} has invited you to join the group
        <strong style="color:#1b1d21;">${escapeHtml(groupName)}</strong> as ${asRole}, so you can
        record and track shared expenses together.
      </p>

      <p style="margin:0 0 24px;">
        <a href="${escapeHtml(acceptUrl)}"
            style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-size:15px;font-weight:500;padding:12px 22px;border-radius:8px;">
          Accept invitation
        </a>
      </p>

      <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#6b7280;">
        This invitation expires on <strong>${escapeHtml(expiry)}</strong> and only
        works when you are signed in as <strong>${escapeHtml(to)}</strong>.
      </p>

      <p style="margin:0 0 20px;font-size:13px;line-height:1.6;color:#6b7280;">
        If the button doesn't work, copy this link into your browser:<br />
        <span style="word-break:break-all;color:#4f46e5;">${escapeHtml(acceptUrl)}</span>
      </p>

      <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 16px;" />

      <p style="margin:0;font-size:12px;line-height:1.6;color:#9ca3af;">
        If you weren't expecting this invitation, you can safely ignore this email.
      </p>
    </div>
  </body>
</html>`;

  return { to, subject, html, text };
}
