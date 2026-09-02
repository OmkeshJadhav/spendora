import { Wallet } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FadeIn } from "@/components/ui/fade-in";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/constants";

/**
 * Placeholder landing page. It is replaced by the real marketing/auth entry
 * point once authentication exists.
 */
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

      <FadeIn delay={0.08}>
        <Card>
          <CardHeader>
            <CardTitle>Setup status</CardTitle>
            <CardDescription>
              The project foundation is in place. Accounts, expenses and groups
              arrive in the next phases.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Badge variant="success">Foundation ready</Badge>
            <Badge>Authentication pending</Badge>
            <Button disabled>Sign in</Button>
          </CardContent>
        </Card>
      </FadeIn>
    </main>
  );
}
