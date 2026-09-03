import "server-only";

import { headers } from "next/headers";

import { getConfiguredOrigin } from "@/lib/env";

/**
 * The origin to build absolute links from — confirmation links, invitation
 * links, anything that leaves the application.
 *
 * `APP_ORIGIN` wins when it is set, because the request's `Host` header is
 * attacker-controllable and these links end up in email. Without it the
 * request's own origin is used, which is what makes development work with no
 * configuration at all.
 */
export async function getSiteOrigin(): Promise<string> {
  const configured = getConfiguredOrigin();

  if (configured) {
    return configured;
  }

  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const protocol =
    headerList.get("x-forwarded-proto") ??
    (host?.startsWith("localhost") ? "http" : "https");

  return `${protocol}://${host}`;
}
