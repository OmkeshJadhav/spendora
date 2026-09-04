import { Compass } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * The 404 for signed-in pages, which `notFound()` reaches whenever a group or
 * an expense is missing — or belongs to somebody else, since RLS makes those
 * two cases indistinguishable on purpose (specification section 32).
 *
 * Sits inside the dashboard layout, so navigation stays available, and the
 * wording avoids confirming whether the thing exists at all.
 */
export default function DashboardNotFound() {
  return (
    <Card>
      <EmptyState
        icon={Compass}
        title="Not found"
        description="This page doesn't exist, or it isn't something your account can open."
        action={
          <Link href="/dashboard" className={buttonVariants()}>
            Back to dashboard
          </Link>
        }
      />
    </Card>
  );
}
