import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card text-card-foreground shadow-xs",
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("flex flex-col gap-1 p-5 pb-3", className)} {...props} />
  );
}

/**
 * A card's heading.
 *
 * Renders `h2` by default, which is the level a card sits at under a page's
 * single `h1` — so the outline a screen reader builds has no gaps in it. Pass
 * `as` where the nesting says otherwise: `h1` on the sign-in card, which *is*
 * its page's heading, or `h3` for a card inside another titled section.
 */
function CardTitle({
  className,
  as: Heading = "h2",
  ...props
}: ComponentProps<"h2"> & { as?: "h1" | "h2" | "h3" }) {
  return (
    <Heading
      className={cn("text-base font-medium text-foreground", className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p className={cn("text-sm text-muted-foreground", className)} {...props} />
  );
}

function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("p-5 pt-0", className)} {...props} />;
}

function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex items-center gap-2 p-5 pt-0", className)}
      {...props}
    />
  );
}

export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
};
