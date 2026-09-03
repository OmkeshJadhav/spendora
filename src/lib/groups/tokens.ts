import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Invitation tokens.
 *
 * The token is the capability that opens an invitation, so it is generated
 * from a CSPRNG and only its SHA-256 is stored (specification section 32):
 * a database leak then hands out no working links. The clear token exists for
 * exactly as long as it takes to put it in an email.
 *
 * 256 bits of entropy is far past guessing range, so the hash needs no salt or
 * key stretching — unlike a password, there is no low-entropy input to protect.
 */

const TOKEN_BYTES = 32;

/** Days a new invitation stays valid (specification section 11). */
export const INVITATION_TTL_DAYS = 7;

export function createInvitationToken(): { token: string; tokenHash: string } {
  // base64url: URL-safe with no percent-encoding to get wrong in an email.
  const token = randomBytes(TOKEN_BYTES).toString("base64url");

  return { token, tokenHash: hashInvitationToken(token) };
}

/** Lowercase hex SHA-256, matching the column's own format constraint. */
export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Shape check before a token is used as a lookup key. Anything else cannot
 * match a stored hash anyway, and rejecting it early keeps junk out of queries.
 */
export function isPlausibleToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{16,128}$/.test(token);
}

/** Constant-time hash comparison, for callers that compare two hashes. */
export function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");

  return left.length === right.length && timingSafeEqual(left, right);
}

export function invitationExpiresAt(from = new Date()): Date {
  const expiry = new Date(from);
  expiry.setUTCDate(expiry.getUTCDate() + INVITATION_TTL_DAYS);

  return expiry;
}
