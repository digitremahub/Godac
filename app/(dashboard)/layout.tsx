import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import { tryAutoProvisionInvitedUser } from "@/lib/auth/provisioning";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let appUser = await getCurrentAppUser();

  if (!appUser) {
    // An invited user's first visit after clicking their email link
    // finishes silently here; an organic sign-up gets sent to
    // onboarding to create their own organisation.
    appUser = await tryAutoProvisionInvitedUser();
  }

  if (!appUser) {
    redirect("/onboarding");
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar role={appUser.role} />
      <div className="flex flex-1 flex-col">
        <TopBar fullName={appUser.full_name} role={appUser.role} />
        <main className="flex-1 overflow-y-auto bg-navy p-6">{children}</main>
      </div>
    </div>
  );
}
