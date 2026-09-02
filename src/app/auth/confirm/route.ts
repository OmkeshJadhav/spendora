import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { safeRedirectPath } from "@/lib/auth/redirects";
import { createClient } from "@/lib/supabase/server";

/**
 * Landing point for links sent by Supabase (email confirmation, password
 * recovery). Verifies the one-time token and establishes the session, then
 * hands the user on to the app.
 */

const ALLOWED_TYPES: readonly EmailOtpType[] = [
  "signup",
  "email",
  "email_change",
  "recovery",
  "invite",
  "magiclink",
];

function isAllowedType(value: string | null): value is EmailOtpType {
  return value !== null && ALLOWED_TYPES.includes(value as EmailOtpType);
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = safeRedirectPath(searchParams.get("next"));

  if (tokenHash && isAllowedType(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });

    if (!error) {
      return NextResponse.redirect(new URL(next, request.url));
    }

    console.error("[auth:confirm]", {
      code: error.code,
      status: error.status,
      message: error.message,
    });
  }

  // Expired, reused or malformed link — send the user somewhere they can act.
  const signIn = new URL("/sign-in", request.url);
  signIn.searchParams.set("error", "invalid_link");

  return NextResponse.redirect(signIn);
}
