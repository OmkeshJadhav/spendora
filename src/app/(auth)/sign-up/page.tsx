import type { Metadata } from "next";

import { SignUpForm } from "@/app/(auth)/_components/sign-up-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { safeRedirectPath } from "@/lib/auth/redirects";

export const metadata: Metadata = {
  title: "Create account",
};

export default async function SignUpPage({
  searchParams,
}: PageProps<"/sign-up">) {
  const params = await searchParams;
  const nextParam = typeof params.next === "string" ? params.next : null;
  // Someone who followed an invitation link before they had an account is sent
  // here; this is what returns them to the invitation once they do.
  const next = safeRedirectPath(nextParam);

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">Create your account</CardTitle>
      </CardHeader>
      <CardContent>
        <SignUpForm next={next === "/dashboard" ? undefined : next} />
      </CardContent>
    </Card>
  );
}
