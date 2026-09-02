import { AppHeader } from "@/components/app-header";
import { requireProfile } from "@/lib/auth/dal";

export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  // Every page in this group also gates itself through the data access layer;
  // this call is what lets the header greet the user by name.
  const profile = await requireProfile();

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader name={profile.name} />
      <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">{children}</div>
    </div>
  );
}
