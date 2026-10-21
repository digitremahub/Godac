import { garderPage } from "@/lib/acces/garde-page";
import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { UsersPanel } from "@/components/admin/UsersPanel";
import { UserImportPanel } from "@/components/admin/UserImportPanel";
import { ROLE_LABELS } from "@/lib/roles/labels";
import type { UserRole } from "@/lib/types/domain";

export default async function AdminUsersPage() {
  const g = await garderPage("equipe.utilisateurs");
  if (!g.ok) return g.ecran;
  const { appUser, supabase } = g;
  const [{ data: users }, { data: services }, { data: userServices }] = await Promise.all([
    supabase
      .from("users")
      .select("id, full_name, email, contact_email, phone, role, role_title, active, auth_method, pin_set_at")
      .order("full_name"),
    supabase.from("services").select("id, name, pole").order("name"),
    supabase.from("user_services").select("user_id, service_id"),
  ]);

  // Décision client Q6 : les managers voient, en lecture, les membres de
  // leur(s) service(s), avec leurs coordonnées. Gestion réservée à la
  // direction et, pour les comptes chauffeur et manager, à l'exploitation.
  if (appUser.role !== "direction" && appUser.role !== "exploitation") {
    const mesServices = new Set((userServices ?? []).filter((r) => r.user_id === appUser.id).map((r) => r.service_id));
    const servicesDe = new Map<string, string[]>();
    for (const r of userServices ?? []) servicesDe.set(r.user_id, [...(servicesDe.get(r.user_id) ?? []), r.service_id]);
    const nomService = new Map((services ?? []).map((s) => [s.id, s.name]));
    const membres = (users ?? []).filter((u) => u.active && (servicesDe.get(u.id) ?? []).some((s) => mesServices.has(s)));
    return (
      <div>
        <PageHeader title="Utilisateurs" description="Membres de votre service (lecture). Les invitations et les rôles sont gérés par la direction." />
        {membres.length === 0 ? (
          <EmptyState title="Aucun membre dans votre service" description="Demandez à la direction de vous rattacher à un service." />
        ) : (
          <Card className="overflow-x-auto !p-0">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-xs text-navy/55">
                <tr className="[&>th]:px-4 [&>th]:py-2.5">
                  <th>Nom</th>
                  <th>Rôle</th>
                  <th>Service</th>
                  <th>Téléphone</th>
                  <th>E-mail</th>
                </tr>
              </thead>
              <tbody>
                {membres.map((u) => (
                  <tr key={u.id} className="border-t border-navy/[0.07] [&>td]:px-4 [&>td]:py-2.5">
                    <td>
                      <Link href={`/equipe/utilisateurs/${u.id}`} className="font-semibold text-teal-ink hover:underline">
                        {u.full_name}
                      </Link>
                    </td>
                    <td>{u.role_title ?? ROLE_LABELS[u.role as UserRole]}</td>
                    <td>{(servicesDe.get(u.id) ?? []).map((s) => nomService.get(s)).filter(Boolean).join(", ")}</td>
                    <td>{u.phone ? <a href={`tel:${u.phone}`}>{u.phone}</a> : "—"}</td>
                    <td>{u.contact_email ?? (u.auth_method === "email" ? u.email : "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    );
  }

  // A user can technically have several services (see user_services);
  // this admin table only edits the first one, matching what the
  // invite flow itself sets.
  const serviceIdByUser = new Map((userServices ?? []).map((r) => [r.user_id, r.service_id]));
  const usersWithService = (users ?? []).map((u) => ({ ...u, service_id: serviceIdByUser.get(u.id) ?? null }));

  return (
    <div>
      <PageHeader
        title="Utilisateurs"
        description={
          appUser.role === "exploitation"
            ? "Comptes chauffeur et manager : création, services, conduite, désactivation. Les autres comptes sont gérés par la direction."
            : "Invitations et gestion des rôles GODAC."
        }
      />
      {appUser.role === "direction" && (
        <div className="mb-4">
          <UserImportPanel />
        </div>
      )}
      <UsersPanel users={usersWithService} services={services ?? []} acteur={appUser.role} />
    </div>
  );
}
