import { garderPage } from "@/lib/acces/garde-page";
import { EmptyState, PageHeader } from "@/components/ui";
import { GestionAcomptes, ReglagePlafondAcompte, type DemandeAvecNom } from "@/components/paie/Acomptes";
import { plafondAcompte } from "@/lib/paie/acomptes";
import { CHAMPS_DEMANDE, MESSAGE_TABLE_ABSENTE, reglagePlafond, tableAcomptesAbsente, versDemande } from "@/lib/paie/acomptes-serveur";

/**
 * Équipe › Paie › Acomptes : les demandes d'acompte des salariés. Le
 * comptable prépare (montant, date), la direction accepte ou refuse —
 * même règle que la validation des bulletins.
 */
export default async function AcomptesPage() {
  const g = await garderPage("equipe.paie_acomptes");
  if (!g.ok) return g.ecran;
  const { appUser, supabase } = g;
  const direction = appUser.role === "direction";
  const depuis = new Date(Date.now() - 400 * 86_400_000).toISOString();

  const [{ data, error }, reglage, { data: bulletins }] = await Promise.all([
    supabase
      .from("salary_advance_requests")
      .select(`${CHAMPS_DEMANDE}, users!salary_advance_requests_user_id_fkey(full_name)`)
      .eq("organization_id", appUser.organization_id)
      .gte("created_at", depuis)
      .order("created_at", { ascending: false })
      .limit(300),
    reglagePlafond(supabase, appUser.organization_id),
    supabase
      .from("payslips")
      .select("user_id, net_amount, details, period_start")
      .eq("organization_id", appUser.organization_id)
      .eq("validation_status", "valide")
      .order("period_start", { ascending: false })
      .limit(500),
  ]);

  if (error) {
    return (
      <div>
        <PageHeader title="Demandes d'acompte" />
        <EmptyState title="Bientôt disponible" description={tableAcomptesAbsente(error) ? MESSAGE_TABLE_ABSENTE : `Lecture impossible : ${error.message}`} />
      </div>
    );
  }

  const demandes: DemandeAvecNom[] = ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    ...versDemande(row),
    nom: ((row.users as { full_name?: string } | null)?.full_name ?? "Salarié") as string,
  }));

  // Plafond indicatif de chaque demandeur : son dernier bulletin validé.
  const plafonds: Record<string, number | null> = {};
  for (const d of demandes) {
    if (d.user_id in plafonds) continue;
    const dernier = (bulletins ?? []).find((b) => b.user_id === d.user_id);
    const net = dernier ? Number((dernier.details as { netAvantRetenues?: number } | null)?.netAvantRetenues ?? dernier.net_amount ?? 0) || null : null;
    plafonds[d.user_id] = plafondAcompte({ netHabituel: net, pourcentage: reglage.pourcentage, montantFixe: reglage.montantFixe });
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Demandes d'acompte"
        description="Un acompte accepté est déduit automatiquement du bulletin du mois (ligne « Acompte du JJ/MM »). Si ce bulletin est déjà validé, il passe au mois suivant."
      />
      <GestionAcomptes demandes={demandes} direction={direction} plafonds={plafonds} />
      {direction && reglage.disponible && <ReglagePlafondAcompte pourcentage={reglage.pourcentage} montantFixe={reglage.montantFixe} />}
    </div>
  );
}
