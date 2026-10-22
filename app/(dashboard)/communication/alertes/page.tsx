import { garderPage } from "@/lib/acces/garde-page";
import { PageHeader } from "@/components/ui";
import { AlertList } from "@/components/alerts/AlertList";
import { chargerAlertes } from "@/lib/alerts/charger";
import type { UserRole } from "@/lib/types/domain";

/** Texte d'introduction selon le rôle : le chauffeur ne traite ni totaliseur ni ticket. */
function description(role: UserRole): string {
  if (role === "chauffeur") return "Vos rappels de planning, messages, réponses à vos demandes et bulletins disponibles.";
  if (role === "comptable") return "Factures, carburant, paie et demandes à traiter, aussi envoyés par e-mail.";
  return "Écarts carburant, entretien, planning et demandes à traiter, aussi envoyés par e-mail.";
}

export default async function AlertsPage() {
  const g = await garderPage("communication.alertes");
  if (!g.ok) return g.ecran;
  const { appUser, supabase, modules } = g;
  // Diffusées et personnelles (jamais le rappel d'un collègue), non lues d'abord.
  const alerts = await chargerAlertes(supabase, appUser.id, { limite: 100 });

  return (
    <div>
      <PageHeader title="Notifications" description={description(appUser.role)} />
      <AlertList alerts={alerts} viewerRole={appUser.role} conduit={appUser.conduit} modules={[...modules]} />
    </div>
  );
}
