import { z } from "zod";

/**
 * Environment configuration.
 *
 * Values are validated lazily so a missing key fails at the point of use with a
 * readable message, rather than crashing an unrelated page at import time.
 * Integrations are wired up in later phases; see `.env.example` for the keys.
 */

const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({
    message: "NEXT_PUBLIC_SUPABASE_URL must be a valid URL",
  }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),
});

const serverEnvSchema = z.object({
  EMAIL_API_KEY: z.string().min(1, "EMAIL_API_KEY is required"),
  EMAIL_FROM: z.email({ message: "EMAIL_FROM must be a valid email address" }),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

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

/** Secrets. Only ever call this from server-side code. */
export function getServerEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error("getServerEnv() must not be called in the browser.");
  }

  return parse(serverEnvSchema, {
    EMAIL_API_KEY: process.env.EMAIL_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
  });
}
