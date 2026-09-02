import type { Metadata } from "next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FadeIn } from "@/components/ui/fade-in";
import { requireProfile } from "@/lib/auth/dal";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default async function DashboardPage() {
  const profile = await requireProfile();

  return (
    <FadeIn className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome, {profile.name}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your account is ready. Expenses and budgets arrive in the next phases.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Nothing to show yet</CardTitle>
          <CardDescription>
            Once expense tracking is built, this is where your monthly total,
            category breakdown and spending trend will live.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          You can update your display name from{" "}
          <span className="text-foreground">Settings</span>.
        </CardContent>
      </Card>
    </FadeIn>
  );
}
