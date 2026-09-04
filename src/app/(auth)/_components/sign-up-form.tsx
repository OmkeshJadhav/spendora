"use client";

import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { signUp } from "@/lib/auth/actions";
import { idleFormState } from "@/lib/auth/form-state";

export function SignUpForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(signUp, idleFormState);
  const signInHref = next
    ? `/sign-in?next=${encodeURIComponent(next)}`
    : "/sign-in";

  useEffect(() => {
    if (state.status === "error" && state.message) {
      toast.error(state.message, { id: "sign-up" });
    }

    if (state.status === "success" && state.message) {
      toast.success(state.message, { id: "sign-up" });
    }
  }, [state]);

  // Sign up succeeded but the account needs email confirmation before signing
  // in, so there is nothing left to fill in on this form.
  if (state.status === "success") {
    return (
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <MailCheck className="size-8 text-success-strong" aria-hidden />
        <h2 className="text-base font-medium">Check your inbox</h2>
        <p className="text-sm text-muted-foreground">{state.message}</p>
        <p className="text-sm text-muted-foreground">
          Once confirmed, you can{" "}
          <Link
            href={signInHref}
            className="font-medium text-primary hover:underline"
          >
            sign in
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <FormField
        label="Name"
        name="name"
        autoComplete="name"
        defaultValue={state.values?.name}
        errors={state.fieldErrors?.name}
        hint="Shown to your group members, for example on “Paid by”."
        placeholder="Your name"
        required
      />

      <FormField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        defaultValue={state.values?.email}
        errors={state.fieldErrors?.email}
        placeholder="you@example.com"
        required
      />

      <FormField
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        errors={state.fieldErrors?.password}
        hint="At least 8 characters."
        required
      />

      <Button type="submit" loading={pending} className="mt-2">
        Create account
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href={signInHref} className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
