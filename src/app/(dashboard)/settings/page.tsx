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
import { requireProfile } from "@/lib/auth/dal";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function SettingsPage() {
  const profile = await requireProfile();

  return (
    <FadeIn className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your profile and account.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-foreground">Profile</CardTitle>
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
          <CardTitle className="text-base text-foreground">Account</CardTitle>
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
