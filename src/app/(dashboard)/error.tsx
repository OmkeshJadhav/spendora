"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Error boundary for signed-in pages (specification section 28).
 *
 * Nested inside the dashboard layout rather than relying on the root boundary,
 * so a page that fails keeps its header and navigation: the user is one click
 * from somewhere that works, instead of on a bare page whose only way out is
 * the browser's back button.
 *
 * The message says what to do, never what went wrong internally — the digest
 * is the thread back to the server log, and nothing else about the failure is
 * shown.
 */
export default function DashboardError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // Technical detail stays in the logs; the user sees a plain message.
    console.error(error);
  }, [error]);

  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-danger/10">
        <AlertTriangle className="size-5 text-danger-strong" aria-hidden />
      </span>

      <div className="flex flex-col gap-1">
        <h1 className="text-base font-medium">This page didn&rsquo;t load</h1>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          Something went wrong while fetching your data. Your records are safe —
          trying again usually fixes it.
        </p>
      </div>

      {error.digest ? (
        <p className="text-xs text-muted-foreground">
          Reference: <span className="font-mono">{error.digest}</span>
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <Button onClick={() => retry()}>
          <RotateCcw aria-hidden />
          Try again
        </Button>
        <Link
          href="/dashboard"
          className={buttonVariants({ variant: "secondary" })}
        >
          Back to dashboard
        </Link>
      </div>
    </Card>
  );
}
