/**
 * Allows only same-site, absolute-path redirects. Anything else — a full URL, a
 * protocol-relative `//evil.com`, a backslash variant — is discarded so a
 * crafted `?next=` cannot bounce a signed-in user off-site.
 */
export function safeRedirectPath(
  value: string | null | undefined,
  fallback = "/dashboard",
): string {
  if (!value || !value.startsWith("/")) {
    return fallback;
  }

  if (value.startsWith("//") || value.startsWith("/\\")) {
    return fallback;
  }

  return value;
}
