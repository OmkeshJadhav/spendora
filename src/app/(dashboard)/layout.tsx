import { AppHeader } from "@/components/app-header";
import { requireProfile } from "@/lib/auth/dal";
import { countMyInvitations } from "@/lib/groups/queries";

export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  // Every page in this group also gates itself through the data access layer;
  // this call is what lets the header greet the user by name.
  const profile = await requireProfile();
  // Memoised per render, so the invitations page pays for this lookup once
  // even though both the header and the page ask for it.
  const invitationCount = await countMyInvitations();

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader name={profile.name} invitationCount={invitationCount} />
      <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">{children}</div>
    </div>
  );
}
