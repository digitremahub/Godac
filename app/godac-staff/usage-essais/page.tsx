import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { isGodacStaffEmail } from "@/lib/godac-staff/auth";
import { PageHeader, Card, StatTile } from "@/components/ui";
import { chargerUsageEssais } from "@/lib/go-navigation/usage-serveur";
import { libelleEssai, libellePourcentage } from "@/lib/go-navigation/usage";

const dateCourte = (v: string) => new Date(v).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });
const dateHeure = (v: string) => new Date(v).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" });

/**
 * Backoffice GODAC › Usage des essais GO Navigation : retours terrain
 * AGRÉGÉS par compte d'essai (tournées, arrêts, optimisations, lectures
 * d'étiquettes, recommandations). Aucune donnée de destinataire ici. Le
 * détail d'un compte n'est consultable qu'avec son accord facultatif.
 * Même contrôle d'accès que app/godac-staff/page.tsx (GODAC_STAFF_EMAILS).
 */
export default async function UsageEssaisPage() {
  const userClient = await createServerSupabaseClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!isGodacStaffEmail(user?.email)) redirect("/dashboard");

  const usage = await chargerUsageEssais(createAdminSupabaseClient());

  return (
    <main className="min-h-screen p-6">
      <PageHeader
        title="Usage des essais GO Navigation"
        description="Statistiques agrégées par compte d'essai. Aucune adresse, aucun nom ni téléphone de destinataire n'est lu ici ; le détail d'un compte n'est accessible qu'avec son accord facultatif."
      />
      <p className="mb-4 text-sm">
        <Link href="/godac-staff" className="text-teal-ink hover:underline">
          ← Backoffice opérateur
        </Link>
        {" · "}
        <Link href="/godac-staff/go-navigation" className="text-teal-ink hover:underline">
          Invitations GO Navigation
        </Link>
      </p>

      {!usage ? (
        <Card>
          <p className="text-sm text-navy/70">Usage des essais indisponible : les organisations d&apos;essai n&apos;ont pas pu être lues (migration 20261023000003_inscription_go_navigation.sql appliquée ?).</p>
        </Card>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Essais actifs" value={`${usage.synthese.actifs} / ${usage.synthese.inscrits}`} />
            <StatTile label="Essais utilisés au moins une fois" value={`${usage.synthese.utilises} / ${usage.synthese.inscrits}`} />
            <StatTile label="Tournées démarrées / créées" value={libellePourcentage(usage.synthese.tauxTourneesDemarrees)} accent="orange" />
            <StatTile label="Arrêts livrés (livrés + échecs)" value={libellePourcentage(usage.synthese.tauxLivraison)} accent="gold" />
          </div>

          <Card className="mb-6">
            <h2 className="mb-1 text-lg">Entonnoir</h2>
            <p className="mb-3 text-sm text-navy/65">
              Nombre de comptes d&apos;essai ayant atteint chaque étape (part des inscrits).
              {usage.synthese.tourneesDemarreesParEssaiUtilise !== null && ` En moyenne ${usage.synthese.tourneesDemarreesParEssaiUtilise.toLocaleString("fr-FR")} tournée(s) démarrée(s) par essai utilisé.`}
            </p>
            <ul className="flex flex-col gap-2">
              {usage.synthese.entonnoir.map((e) => (
                <li key={e.cle} className="text-sm">
                  <div className="flex justify-between gap-2">
                    <span>{e.libelle}</span>
                    <span className="tabular-nums">
                      {e.nombre} · {libellePourcentage(e.pourcentage)}
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-navy/10">
                    <div className="h-2 rounded-full bg-teal" style={{ width: `${e.pourcentage ?? 0}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="overflow-x-auto">
            {usage.lignes.length === 0 ? (
              <p className="text-sm text-navy/60">Aucun compte d&apos;essai pour l&apos;instant.</p>
            ) : (
              <table className="w-full min-w-[1100px] text-sm">
                <thead className="text-left text-navy/60">
                  <tr>
                    <th className="pb-2">Compte d&apos;essai</th>
                    <th className="pb-2">Inscrit le</th>
                    <th className="pb-2">Essai</th>
                    <th className="pb-2">Dernière connexion</th>
                    <th className="pb-2" title="Créées / démarrées / clôturées">Tournées</th>
                    <th className="pb-2" title="Total / livrés / échecs">Arrêts</th>
                    <th className="pb-2" title="Arrêts créés après le démarrage de leur tournée">Ajoutés en tournée</th>
                    <th className="pb-2">Optimisations</th>
                    <th className="pb-2">Étiquettes lues</th>
                    <th className="pb-2">Recommandations</th>
                    <th className="pb-2">Détail</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.lignes.map((l) => (
                    <tr key={l.id} className="border-t border-navy/5 align-top">
                      <td className="py-2">
                        {l.nom}
                        {l.apporteur && <span className="block text-xs text-navy/55">Apporteur : {l.apporteur}</span>}
                      </td>
                      <td className="py-2">{dateCourte(l.inscritLe)}</td>
                      <td className="py-2">
                        <span className={l.abonne ? "badge-teal" : l.essaiTermine ? "badge-gold" : "badge-teal"}>{libelleEssai(l)}</span>
                      </td>
                      <td className="py-2">{l.derniereActivite ? dateHeure(l.derniereActivite) : "Jamais"}</td>
                      <td className="py-2 tabular-nums">
                        {l.tourneesCreees} / {l.tourneesDemarrees} / {l.tourneesCloturees}
                      </td>
                      <td className="py-2 tabular-nums">
                        {l.arrets} / {l.arretsLivres} / {l.arretsEchec}
                      </td>
                      <td className="py-2 tabular-nums">{l.arretsAjoutesEnTournee}</td>
                      <td className="py-2 tabular-nums">{l.optimisations}</td>
                      <td className="py-2 tabular-nums">{l.lecturesEtiquettes}</td>
                      <td className="py-2 tabular-nums">{l.recommandations}</td>
                      <td className="py-2">
                        {l.accordDetail ? (
                          <Link href={`/godac-staff/usage-essais/${l.id}`} className="text-teal-ink hover:underline">
                            Détail
                          </Link>
                        ) : (
                          <span className="text-xs text-navy/55">Pas d&apos;accord</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <p className="mt-3 max-w-3xl text-xs text-navy/60">
            Sources : tournées et arrêts (état), journal de consommation (optimisations, lectures d&apos;étiquettes), recommandations d&apos;employeur envoyées et dernière connexion du compte. Les « ajoutés en tournée » sont les arrêts créés après le démarrage de leur tournée.
          </p>
        </>
      )}
    </main>
  );
}
