import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { isGodacStaffEmail } from "@/lib/godac-staff/auth";
import { PageHeader } from "@/components/ui";
import { StaffUsersPanel } from "@/components/godac-staff/StaffUsersPanel";

export default async function GodacStaffOrgPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const userClient = await createServerSupabaseClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();

  if (!isGodacStaffEmail(user?.email)) {
    redirect("/dashboard");
  }

  const admin = createAdminSupabaseClient();
  const [{ data: organization }, { data: users }] = await Promise.all([
    admin.from("organizations").select("id, name").eq("id", orgId).single(),
    admin.from("users").select("id, full_name, email, role, active").eq("organization_id", orgId).order("full_name"),
  ]);

  if (!organization) redirect("/godac-staff");

  return (
    <main className="min-h-screen p-6">
      <Link href="/godac-staff" className="text-sm text-teal-ink hover:underline">
        ← Toutes les organisations
      </Link>
      <PageHeader
        title={organization.name}
        description="Rôles et accès — hors RLS, sans la protection anti-verrouillage de l'admin client (voir app/api/godac-staff/users/[id])."
      />
      <StaffUsersPanel users={(users ?? []) as any} />
    </main>
  );
}
