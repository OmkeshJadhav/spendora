"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { signIn } from "@/lib/auth/actions";
import { idleFormState } from "@/lib/auth/form-state";

export function SignInForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(signIn, idleFormState);

  useEffect(() => {
    if (state.status === "error" && state.message) {
      // A stable id keeps repeated failures from stacking up.
      toast.error(state.message, { id: "sign-in" });
    }
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}

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
        autoComplete="current-password"
        errors={state.fieldErrors?.password}
        required
      />

      <Button type="submit" loading={pending} className="mt-2">
        Sign in
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        New here?{" "}
        <Link href="/sign-up" className="font-medium text-primary hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}
