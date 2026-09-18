import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { UsersPanel } from "@/components/admin/UsersPanel";

export default async function AdminUsersPage() {
  const supabase = await createServerSupabaseClient();
  const [{ data: users }, { data: services }, { data: userServices }] = await Promise.all([
    supabase.from("users").select("id, full_name, email, phone, role, role_title, active").order("full_name"),
    supabase.from("services").select("id, name").order("name"),
    supabase.from("user_services").select("user_id, service_id"),
  ]);

  // A user can technically have several services (see user_services);
  // this admin table only edits the first one, matching what the
  // invite flow itself sets.
  const serviceIdByUser = new Map((userServices ?? []).map((r) => [r.user_id, r.service_id]));
  const usersWithService = (users ?? []).map((u) => ({ ...u, service_id: serviceIdByUser.get(u.id) ?? null }));

  return (
    <div>
      <PageHeader title="Utilisateurs" description="Invitations et gestion des rôles GODAC." />
      <UsersPanel users={usersWithService} services={services ?? []} />
    </div>
  );
}
