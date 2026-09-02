import { Wallet } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { FadeIn } from "@/components/ui/fade-in";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/constants";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-8 px-6 py-16">
      <FadeIn className="flex flex-col gap-4">
        <span className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Wallet className="size-4 text-primary" aria-hidden />
          {APP_NAME}
        </span>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Expenses that stay clear, month after month.
        </h1>
        <p className="max-w-xl text-base text-muted-foreground">
          {APP_DESCRIPTION}
        </p>
      </FadeIn>

      <FadeIn delay={0.08} className="flex flex-col gap-3 sm:flex-row">
        <Link href="/sign-up" className={buttonVariants({ size: "lg" })}>
          Create an account
        </Link>
        <Link
          href="/sign-in"
          className={buttonVariants({ variant: "secondary", size: "lg" })}
        >
          Sign in
        </Link>
      </FadeIn>
    </main>
  );
}
