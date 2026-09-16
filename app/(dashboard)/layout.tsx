import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/clerk/roles";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const appUser = await getCurrentAppUser();

  if (!appUser) {
    // Clerk session exists (middleware already enforced that) but the
    // webhook hasn't synced this membership into Supabase yet, or the
    // user was deactivated.
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
