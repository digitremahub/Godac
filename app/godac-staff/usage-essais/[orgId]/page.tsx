import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { isGodacStaffEmail } from "@/lib/godac-staff/auth";
import { journaliser } from "@/lib/audit/journal";
import { PageHeader, Card } from "@/components/ui";
import { chargerDetailEssai } from "@/lib/go-navigation/usage-serveur";
import { LIBELLES_STATUT_TOURNEE, libelleDuree } from "@/lib/go-navigation/usage";

const dateCourte = (v: string) => new Date(`${v}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });
const heure = (v: string | null) => (v ? new Date(v).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }) : "—");
const dateHeure = (v: string) => new Date(v).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "medium" });

const REFUS = {
  introuvable: "Compte d'essai introuvable.",
  pas_un_essai: "Cette organisation n'est pas un compte d'essai GO Navigation.",
  accord_absent: "Cet utilisateur n'a pas donné son accord pour le partage du détail de son usage (ou l'a retiré). Seules les statistiques agrégées sont disponibles.",
  migration_manquante: "Le réglage d'accord n'est pas encore disponible : appliquez la migration 20261103000004_accord_usage_essai.sql.",
} as const;

/**
 * Backoffice GODAC › Usage d'un essai, DÉTAIL : tournées (compteurs et
 * horaires) et chronologie d'usage, sans nom, adresse, téléphone, code colis
 * ni position GPS. Refusé tant que l'utilisateur n'a pas donné son accord
 * facultatif (vérifié côté serveur, à chaque affichage). Chaque consultation
 * est tracée dans le journal d'audit de l'organisation.
 */
export default async function DetailUsageEssaiPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const userClient = await createServerSupabaseClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!isGodacStaffEmail(user?.email)) redirect("/dashboard");

  const detail = /^[0-9a-f-]{36}$/i.test(orgId) ? await chargerDetailEssai(createAdminSupabaseClient(), orgId) : ({ ok: false, raison: "introuvable" } as const);
  if (detail.ok) {
    await journaliser({ organizationId: orgId, userId: null, action: "usage_essai_detail_consulte", targetTable: "organizations", targetId: orgId, details: { par: "équipe GODAC" } });
  }

  return (
    <main className="min-h-screen p-6">
      <PageHeader
        title={detail.ok ? `Usage détaillé — ${detail.nom}` : "Usage détaillé d'un essai"}
        description="Tournées et chronologie d'usage, sans nom, adresse, téléphone, code colis ni position GPS. Consultation possible avec l'accord facultatif de l'utilisateur."
      />
      <p className="mb-4 text-sm">
        <Link href="/godac-staff/usage-essais" className="text-teal-ink hover:underline">
          ← Usage des essais
        </Link>
      </p>

      {!detail.ok ? (
        <Card>
          <p role="alert" className="text-sm text-navy/80">
            {REFUS[detail.raison]}
          </p>
        </Card>
      ) : (
        <>
          {detail.accordLe && <p className="mb-4 text-xs text-navy/60">Accord donné ou modifié le {dateHeure(detail.accordLe)}. L&apos;utilisateur peut le retirer à tout moment.</p>}
          <Card className="mb-6 overflow-x-auto">
            <h2 className="mb-2 text-lg">Tournées</h2>
            {detail.tournees.length === 0 ? (
              <p className="text-sm text-navy/60">Aucune tournée pour l&apos;instant.</p>
            ) : (
              <table className="w-full min-w-[720px] text-sm">
                <thead className="text-left text-navy/60">
                  <tr>
                    <th className="pb-2">Date</th>
                    <th className="pb-2">Statut</th>
                    <th className="pb-2">Arrêts</th>
                    <th className="pb-2">Livrés</th>
                    <th className="pb-2">Échecs</th>
                    <th className="pb-2">Démarrage</th>
                    <th className="pb-2" title="Heure du dernier arrêt traité : aucune heure de clôture n'est enregistrée">Fin (dernier arrêt)</th>
                    <th className="pb-2">Durée</th>
                    <th className="pb-2">Optimisation</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.tournees.map((t) => (
                    <tr key={t.id} className="border-t border-navy/5">
                      <td className="py-2">{dateCourte(t.date)}</td>
                      <td className="py-2">{LIBELLES_STATUT_TOURNEE[t.statut] ?? t.statut}</td>
                      <td className="py-2 tabular-nums">{t.arrets}</td>
                      <td className="py-2 tabular-nums">{t.livres}</td>
                      <td className="py-2 tabular-nums">{t.echecs}</td>
                      <td className="py-2">{heure(t.debut)}</td>
                      <td className="py-2">{heure(t.fin)}</td>
                      <td className="py-2">{libelleDuree(t.dureeMinutes)}</td>
                      <td className="py-2">{t.optimisee ? "Oui" : "Non"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card className="overflow-x-auto">
            <h2 className="mb-2 text-lg">Chronologie d&apos;usage</h2>
            {detail.evenements.length === 0 ? (
              <p className="text-sm text-navy/60">Aucun événement enregistré.</p>
            ) : (
              <>
                <p className="mb-2 text-xs text-navy/60">Les {detail.evenements.length} événements les plus récents, type et horodatage seulement.</p>
                <ul className="flex flex-col text-sm">
                  {detail.evenements.map((e, i) => (
                    <li key={`${e.at}-${i}`} className="flex gap-4 border-t border-navy/5 py-1.5">
                      <span className="w-40 shrink-0 tabular-nums text-navy/65">{dateHeure(e.at)}</span>
                      <span>{e.libelle}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </>
      )}
    </main>
  );
}
