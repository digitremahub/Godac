import Link from "next/link";
import { Card, StatTile } from "@/components/ui";
import { AlertList } from "@/components/alerts/AlertList";
import { BarChartCard } from "@/components/reporting/BarChartCard";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { AppUser } from "@/lib/auth/session";
import { urlDe } from "@/lib/acces/catalogue";
import { ecranTourneesEnCours, tuilesOuvrables } from "@/lib/acces/tuiles-accueil";
import { chargerAlertes } from "@/lib/alerts/charger";
import { filtreDestinataire } from "@/lib/alerts/lecture";
import { agregatsAccueilRequete } from "@/lib/accueil/agregats-serveur";
import { planningDuJourRequete, tourneesSuiviesRequete } from "@/lib/exploitation/planning-jour";
import { FILTRE_CONDUCTEURS } from "@/lib/roles/conducteurs";
import { getFleetConsumptionRanking } from "@/lib/vehicles/consumption";

/**
 * Blocs lourds des accueils direction et exploitation, chacun dans son
 * <Suspense> (squelette) : l'en-tête et « À traiter » s'affichent sans
 * attendre les agrégats, le classement de consommation ni les tournées.
 * Lectures partagées par requête (React cache) : jamais deux fois les
 * mêmes tournées ni les mêmes agrégats.
 */

const heure = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });

/** Squelette d'un bloc en chargement. */
export function Squelette({ titre, lignes = 3 }: { titre?: string; lignes?: number }) {
  return (
    <Card className="mb-6">
      <p className="sr-only" role="status">
        Chargement{titre ? ` : ${titre}` : ""}…
      </p>
      <div className="mb-3 h-5 w-48 animate-pulse rounded bg-navy/[0.08]" aria-hidden="true" />
      <div className="flex flex-col gap-2" aria-hidden="true">
        {Array.from({ length: lignes }, (_, i) => (
          <div key={i} className="h-11 animate-pulse rounded-xl bg-navy/[0.05]" />
        ))}
      </div>
    </Card>
  );
}

/** Rangée de tuiles en chargement. */
export function SqueletteTuiles({ n = 5 }: { n?: number }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5" aria-busy="true">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-2xl bg-navy/[0.05]" aria-hidden="true" />
      ))}
    </div>
  );
}

function Tuiles({ tuiles }: { tuiles: { libelle: string; valeur: string; accent?: "teal" | "orange" | "gold"; href: string }[] }) {
  return (
    <>
      {tuiles.map((t) => (
        <Link key={t.libelle} href={t.href} className="block">
          <StatTile label={t.libelle} value={t.valeur} accent={t.accent} />
        </Link>
      ))}
    </>
  );
}

/** Indicateurs de la direction : carburant du mois, flotte, chauffeurs, tournées, notifications ouvertes. */
export async function IndicateursDirection({ appUser, enabledModules }: { appUser: AppUser; enabledModules: string[] }) {
  const supabase = await createServerSupabaseClient();
  const ctx = { role: appUser.role, modules: new Set(enabledModules) };
  const ecranTournees = ecranTourneesEnCours(ctx);
  const [vehicules, chauffeurs, alertesOuvertes, agregats, tournees] = await Promise.all([
    supabase.from("vehicles").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("users").select("id", { count: "exact", head: true }).or(FILTRE_CONDUCTEURS).eq("active", true),
    // Seules les alertes ouvertes comptent : lues ou non, une alerte prise en compte ou traitée n'attend plus rien.
    supabase.from("alerts").select("id", { count: "exact", head: true }).eq("status", "open").or(filtreDestinataire(appUser.id)),
    agregatsAccueilRequete(appUser.organization_id, enabledModules.includes("bi_reporting")),
    ecranTournees === "exploitation.suivi" ? tourneesSuiviesRequete(appUser.id, appUser.role, appUser.organization_id).catch(() => null) : Promise.resolve(null),
  ]);
  const ouvertes = alertesOuvertes.count ?? 0;
  const autres = tuilesOuvrables(
    [
      ecranTournees && { libelle: "Suivi en direct", valeur: tournees ? String(tournees.length) : "—", accent: "teal", ecran: ecranTournees },
      { libelle: "Notifications ouvertes", valeur: String(ouvertes), accent: ouvertes ? "orange" : "teal", ecran: "communication.alertes" },
    ],
    ctx,
  );
  return (
    <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      <StatTile label={`Carburant ce mois${agregats.tronque ? " (tronqué)" : ""}`} value={`${Math.round(agregats.coutMois).toLocaleString("fr-FR")} €`} accent="gold" />
      <StatTile label="Véhicules actifs" value={String(vehicules.count ?? 0)} />
      <StatTile label="Chauffeurs actifs" value={String(chauffeurs.count ?? 0)} accent="gold" />
      <Tuiles tuiles={autres} />
    </div>
  );
}

/** Tournées colis démarrées ou en chargement (lecture partagée avec « À traiter »). */
export async function TourneesColisEnCours({ appUser, enabledModules }: { appUser: AppUser; enabledModules: string[] }) {
  const ecranTournees = ecranTourneesEnCours({ role: appUser.role, modules: new Set(enabledModules) });
  let tournees: Awaited<ReturnType<typeof tourneesSuiviesRequete>> = [];
  let indisponible = false;
  if (ecranTournees === "exploitation.suivi") {
    try {
      tournees = (await tourneesSuiviesRequete(appUser.id, appUser.role, appUser.organization_id)).filter((t) => t.statut !== "done");
    } catch {
      indisponible = true;
    }
  }
  return (
    <Card className="mb-6">
      {indisponible && (
        <p role="alert" className="mb-3 rounded-lg border border-orange/40 bg-orange/10 p-3 text-sm text-orange-ink">
          Le suivi en direct est momentanément indisponible. Réessayez dans quelques minutes ou contactez le support.
        </p>
      )}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg">Tournées colis en cours</h2>
          <p className="text-sm text-navy/60">Tournées colis démarrées ou en chargement.</p>
        </div>
        {ecranTournees && (
          <Link href={urlDe(ecranTournees)} className="text-sm text-teal-ink hover:underline">
            {ecranTournees === "exploitation.suivi" ? "Suivi en direct →" : "Voir le détail →"}
          </Link>
        )}
      </div>
      {tournees.length === 0 ? (
        <p className="text-sm text-navy/60">Aucune tournée colis en cours pour le moment.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {tournees.map((t) => (
            <li key={t.id} className="flex flex-col gap-1 rounded-xl border border-navy/10 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold">{t.nom ?? "Tournée du jour"}</p>
                <p className="text-sm text-navy/65">
                  {t.chauffeur} · {t.services.map((s) => s.nom).join(", ") || "Service non renseigné"}
                </p>
              </div>
              <div className="text-sm text-navy/65 sm:text-right">
                <p>{t.vehicule ?? "Véhicule non renseigné"}</p>
                <p>{t.demarreeA ? heure(t.demarreeA) : "Heure de départ inconnue"}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Reporting (30 jours) de l'accueil direction : agrégats SQL, deux graphiques. */
export async function ReportingDirection({ appUser }: { appUser: AppUser }) {
  const agregats = await agregatsAccueilRequete(appUser.organization_id, true);
  return (
    <div className="mb-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg">Reporting (30 jours)</h2>
        <Link href={urlDe("dashboard.reporting")} className="text-sm text-teal-ink hover:underline">
          Voir le reporting complet →
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BarChartCard title="Coût carburant par véhicule (top 8)" data={agregats.coutParVehicule} valueSuffix=" €" />
        <BarChartCard title="Tournées par service" data={agregats.tourneesParService} />
      </div>
      {agregats.tronque && <p className="mt-2 text-xs text-orange-ink">Résultats tronqués : trop de lignes sur la période, les totaux sont incomplets.</p>}
    </div>
  );
}

/** Classement de consommation (30 jours) de la flotte visible par la personne. */
export async function ClassementConsommation({ className = "" }: { className?: string }) {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.from("vehicles").select("id, registration").eq("status", "active");
  const classement = await getFleetConsumptionRanking(supabase, (data ?? []) as { id: string; registration: string }[], 30);
  return (
    <Card className={className}>
      <h2 className="mb-3 text-lg">Consommation (30 jours)</h2>
      {classement.length === 0 ? (
        <p className="text-sm text-navy/60">Pas assez de données pour établir un classement.</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {classement.map((v) => (
            <li key={v.registration} className="flex items-center justify-between rounded-xl bg-navy/[0.035] px-3.5 py-2.5">
              <span>{v.registration}</span>
              <span className="font-medium">{v.consumption} L/100km</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Notifications ouvertes de la personne (cinq dernières). */
export async function NotificationsOuvertes({ appUser, enabledModules, masquerSiVide = false }: { appUser: AppUser; enabledModules: string[]; masquerSiVide?: boolean }) {
  const supabase = await createServerSupabaseClient();
  const alertes = await chargerAlertes(supabase, appUser.id, { ouvertes: true, limite: 5 });
  if (masquerSiVide && alertes.length === 0) return null;
  return (
    <div>
      <h2 className="mb-3 text-lg">Notifications</h2>
      <AlertList alerts={alertes} viewerRole={appUser.role} conduit={appUser.conduit} modules={enabledModules} />
    </div>
  );
}

/** Tournées du planning en cours (exploitation) : lecture partagée avec « À traiter ». */
export async function TourneesPlanningEnCours({ appUser }: { appUser: AppUser }) {
  const lignes = (await planningDuJourRequete(appUser.organization_id)).filter((t) => t.status === "in_progress");
  const un = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  return (
    <Card className="lg:col-span-2">
      <h2 className="mb-3 text-lg">Tournées en cours</h2>
      {lignes.length === 0 ? (
        <p className="text-sm text-navy/60">Aucune tournée en cours actuellement.</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {lignes.map((t) => (
            <li key={t.id} className="flex items-center justify-between rounded-xl bg-navy/[0.035] px-3.5 py-2.5">
              <span>
                {un(t.users)?.full_name ?? "—"} · {un(t.vehicles)?.registration ?? "—"} · n°{t.tour_number}
              </span>
              <span className="text-xs text-navy/60">depuis {heure(t.start_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
