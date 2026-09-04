import type { Metadata } from "next";

import { ProfileForm } from "@/app/(dashboard)/settings/_components/profile-form";
import { SignOutButton } from "@/components/sign-out-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FadeIn } from "@/components/ui/fade-in";
import { PageHeader } from "@/components/ui/page-header";
import { requireProfile } from "@/lib/auth/dal";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function SettingsPage() {
  const profile = await requireProfile();

  return (
    <FadeIn className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        description="Manage your profile and account."
      />

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            Signed in as <span className="text-foreground">{profile.email}</span>
            . Your email address cannot be changed here yet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm name={profile.name} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>
            Signing out ends this session on this device.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignOutButton />
        </CardContent>
      </Card>
    </FadeIn>
  );
}
