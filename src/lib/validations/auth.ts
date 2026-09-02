import { z } from "zod";

/**
 * Auth input schemas. The same schemas run in the browser for fast feedback and
 * on the server for safety — the server never trusts the client's checks.
 */

const email = z
  .string()
  .trim()
  .min(1, "Email is required")
  .pipe(z.email("Enter a valid email address"))
  .transform((value) => value.toLowerCase());

const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password must be 72 characters or fewer");

export const nameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(80, "Name must be 80 characters or fewer");

export const signUpSchema = z.object({
  name: nameSchema,
  email,
  password,
});

export const signInSchema = z.object({
  email,
  // Length rules deliberately are not applied on sign in: an existing password
  // should fail as "wrong credentials", not as a validation error.
  password: z.string().min(1, "Password is required"),
});

export const updateProfileSchema = z.object({
  name: nameSchema,
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
