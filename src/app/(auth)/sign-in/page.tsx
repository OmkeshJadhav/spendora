import type { Metadata } from "next";

import { SignInForm } from "@/app/(auth)/_components/sign-in-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { safeRedirectPath } from "@/lib/auth/redirects";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function SignInPage({
  searchParams,
}: PageProps<"/sign-in">) {
  const params = await searchParams;
  const nextParam = typeof params.next === "string" ? params.next : null;
  // Only forward a same-site path; anything else falls back to the dashboard.
  const next = safeRedirectPath(nextParam);
  const linkError = params.error === "invalid_link";
  const unconfirmed = params.error === "email_not_confirmed";

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">Sign in to your account</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {linkError ? (
          <p
            role="alert"
            className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger-strong"
          >
            That link is invalid or has expired. Please sign in, or request a new
            link.
          </p>
        ) : null}
        {unconfirmed ? (
          <p
            role="alert"
            className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning-strong"
          >
            Your email address has not been confirmed yet. Follow the link we
            sent you, then sign in.
          </p>
        ) : null}
        <SignInForm next={next === "/dashboard" ? undefined : next} />
      </CardContent>
    </Card>
  );
}
