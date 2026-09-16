import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { UsersPanel } from "@/components/admin/UsersPanel";

export default async function AdminUsersPage() {
  const supabase = await createServerSupabaseClient();
  const [{ data: users }, { data: services }] = await Promise.all([
    supabase.from("users").select("id, full_name, email, role, active").order("full_name"),
    supabase.from("services").select("id, name").order("name"),
  ]);

  return (
    <div>
      <PageHeader title="Utilisateurs" description="Invitations et gestion des rôles GODAC." />
      <UsersPanel users={users ?? []} services={services ?? []} />
    </div>
  );
}
