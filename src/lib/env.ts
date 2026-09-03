import { z } from "zod";

/**
 * Environment configuration.
 *
 * Values are validated lazily so a missing key fails at the point of use with a
 * readable message, rather than crashing an unrelated page at import time.
 * See `.env.example` for the keys.
 */

const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({
    message: "NEXT_PUBLIC_SUPABASE_URL must be a valid URL",
  }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),
});

const emailEnvSchema = z.object({
  EMAIL_API_KEY: z.string().min(1, "EMAIL_API_KEY is required"),
  EMAIL_FROM: z
    .string()
    .min(1, "EMAIL_FROM is required")
    // Providers accept both "you@example.com" and "Name <you@example.com>".
    .refine(
      (value) => /^[^<>]+<[^<>@\s]+@[^<>@\s]+>$|^[^<>@\s]+@[^<>@\s]+$/.test(value.trim()),
      "EMAIL_FROM must be an email address, optionally as \"Name <you@example.com>\"",
    ),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;
export type EmailEnv = z.infer<typeof emailEnvSchema>;

function parse<T>(schema: z.ZodType<T>, source: Record<string, unknown>): T {
  const result = schema.safeParse(source);

  if (!result.success) {
    const missing = result.error.issues
      .map((issue) => issue.message)
      .join("; ");
    // Never include the values themselves — only which keys are wrong.
    throw new Error(
      `Invalid environment configuration: ${missing}. See .env.example.`,
    );
  }

  return result.data;
}

/**
 * Public configuration, safe to read in the browser. `process.env` keys must be
 * written out literally so Next.js can inline them at build time.
 */
export function getClientEnv(): ClientEnv {
  return parse(clientEnvSchema, {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

/**
 * Email provider secrets, or null when the provider is not configured.
 *
 * Null rather than a throw: an unconfigured provider is a deployment state the
 * application handles (the invitation is still created, and its link is handed
 * to the admin to pass on), not a programming error that should take a page
 * down. Anything malformed still throws, because that is a mistake.
 */
export function getEmailEnv(): EmailEnv | null {
  if (typeof window !== "undefined") {
    throw new Error("getEmailEnv() must not be called in the browser.");
  }

  const apiKey = process.env.EMAIL_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();

  if (!apiKey && !from) {
    return null;
  }

  return parse(emailEnvSchema, { EMAIL_API_KEY: apiKey, EMAIL_FROM: from });
}

/**
 * The canonical origin links in outgoing email should point at.
 *
 * Optional: when it is unset the request's own origin is used instead, which is
 * right in development. Setting it in production means a spoofed `Host` header
 * cannot rewrite the link inside an invitation email.
 */
export function getConfiguredOrigin(): string | null {
  const value = process.env.APP_ORIGIN?.trim();

  if (!value) {
    return null;
  }

  const parsed = z.url().safeParse(value);

  if (!parsed.success) {
    throw new Error("Invalid environment configuration: APP_ORIGIN must be a valid URL.");
  }

  return parsed.data.replace(/\/$/, "");
}
