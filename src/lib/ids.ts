/**
 * Identifier shape checks.
 *
 * Every row in the schema is keyed by a `uuid`, and ids reach the server from
 * two places that cannot be trusted to send one: a route segment
 * (`/groups/<id>`) and a query parameter (`?category=<id>`).
 *
 * PostgreSQL rejects a malformed uuid with `22P02` rather than returning no
 * rows, so a query built from an unchecked segment *throws* instead of coming
 * back empty. That turned "no such group" into an error page and, on the export
 * route, into a 500 — when the honest answer is the one a stranger's valid id
 * already gets: not found. Checking the shape first collapses the two cases,
 * which is also what stops a stream of junk ids writing a database error into
 * the log on every request.
 *
 * This is not an authorization check and is not a substitute for one. A
 * well-formed id says nothing about who may read the row; RLS answers that.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `value` could name a row — nothing about whether it does. */
export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
