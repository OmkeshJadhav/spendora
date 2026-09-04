import { AppHeader } from "@/components/app-header";
import { MobileNav } from "@/components/mobile-nav";
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
      {/*
        The first thing a keyboard or screen-reader user meets, so the header's
        navigation is not something they have to walk through on every page
        (specification section 40). Visually hidden until it takes focus.
      */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <AppHeader name={profile.name} invitationCount={invitationCount} />

      <main
        id="main-content"
        // `pb-24` on small screens clears the fixed bottom navigation, which is
        // out of the document flow and would otherwise sit over the last row
        // of any page.
        className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-24 sm:px-6 sm:py-8"
      >
        {children}
      </main>

      <MobileNav />
    </div>
  );
}
