import Link from "next/link";
import { Suspense } from "react";
import { ATraiterAttente, ATraiterBloc } from "@/components/dashboard/ATraiterBloc";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader, StatTile, Card } from "@/components/ui";
import { QrCodeBadge } from "@/components/qr/QrCodeBadge";
import { AlertList } from "@/components/alerts/AlertList";
import { TourHeroCard } from "@/components/dashboard/TourHeroCard";
import { AssistedClock } from "@/components/time-clock/AssistedClock";
import type { AppUser } from "@/lib/auth/session";
import { chargerAlertes, type AlerteAffichee } from "@/lib/alerts/charger";
import { ecranOuvrable } from "@/lib/acces/tuiles-accueil";
import { urlDe } from "@/lib/acces/catalogue";
import { chargerAccueilChefEquipe, type Source } from "@/lib/accueil/chef-equipe-serveur";
import {
  ancienneteJours,
  compterEquipe,
  compterVehicules,
  LIBELLE_ETAT_MEMBRE,
  LIBELLE_ETAT_VEHICULE,
  LIBELLE_STATUT_AMENDE,
  LIBELLE_STATUT_CONTESTATION,
  libelleAnciennete,
  mentionHierarchie,
  plafonner,
  resumeEquipe,
  trierParAnciennete,
  type DossierOuvert,
  type EtatMembre,
  type EtatVehicule,
} from "@/lib/accueil/chef-equipe";
import { dateParis } from "@/lib/rattachement/format";

const BADGE_MEMBRE: Record<EtatMembre, string> = {
  en_tournee: "badge-teal",
  disponible: "badge-neutral",
  non_planifie: "badge-neutral",
  conge: "badge-gold",
  arret: "badge-orange",
};

const BADGE_VEHICULE: Record<EtatVehicule, string> = {
  en_tournee: "badge-teal",
  disponible: "badge-neutral",
  entretien: "badge-gold",
  hors_service: "badge-orange",
};

/** Lignes montrées sur l'accueil quand un « Voir tout » mène au détail, sinon davantage. */
const COURT = 6;
const LONG = 25;

const LIGNE = "flex min-h-[44px] items-center justify-between gap-3 rounded-xl bg-navy/[0.035] px-3.5 py-2.5";
const LIEN_VOIR_TOUT = "inline-flex min-h-[44px] items-center text-sm text-teal-ink underline";

/**
 * Accueil du manager (chef d'équipe d'un ou plusieurs services) : son
 * équipe, les véhicules de ses services, les amendes et contestations
 * ouvertes, et les notifications de l'exploitation ou de la direction.
 * Rien d'autre (ni carburant, ni tournées globales, ni inscriptions).
 * L'exploitation et la direction gardent leurs propres accueils.
 *
 * Périmètre strict : ses services (user_services). Un manager qui conduit
 * garde la carte Départ / Retour et le pointage assisté ; son badge QR est
 * rangé en bas de page.
 */
export async function ChefEquipeDashboard({ appUser, enabledModules }: { appUser: AppUser; enabledModules: string[] }) {
  const supabase = await createServerSupabaseClient();
  const ctx = { role: appUser.role, modules: new Set(enabledModules), conduit: appUser.conduit };
  const ouvre = (id: string) => ecranOuvrable(id, ctx);

  const tourneeOuvrable = appUser.conduit && ouvre("moi.tournee_depart");
  const equipeOuverte = ouvre("equipe.utilisateurs");
  const ficheOuverte = ouvre("equipe.utilisateur_fiche");
  const flotteOuverte = ouvre("flotte.vehicules");
  const ficheVehiculeOuverte = ouvre("flotte.vehicule_fiche");
  const amendesOuvertes = ouvre("flotte.amendes");
  const contestationsOuvertes = ouvre("exploitation.contestations");
  const congesOuverts = enabledModules.includes("leave_management") && ouvre("equipe.conges");
  const entretienOuvert = enabledModules.includes("maintenance_requests") && ouvre("flotte.entretien");

  const [donnees, alertesLues, tourneeOuverte, autoClock] = await Promise.all([
    chargerAccueilChefEquipe(supabase, appUser, { amendes: amendesOuvertes, contestations: contestationsOuvertes, conges: congesOuverts, entretiens: entretienOuvert }),
    // Diffusées et personnelles (exploitation, direction), jamais le rappel d'un collègue.
    chargerAlertes(supabase, appUser.id, { ouvertes: true, limite: 5 }).then(
      (alertes) => ({ alertes, erreur: false }),
      (e) => {
        console.warn("[accueil manager] notifications : lecture impossible", e instanceof Error ? e.message : e);
        return { alertes: [] as AlerteAffichee[], erreur: true };
      },
    ),
    appUser.conduit
      ? supabase
          .from("planning_entries")
          .select("id, tour_number, start_at, vehicles(registration)")
          .eq("driver_id", appUser.id)
          .eq("status", "in_progress")
          .maybeSingle()
          .then((r) => r.data as { id: string; tour_number: string; start_at: string; vehicles: { registration: string } | null } | null)
      : Promise.resolve(null),
    // Pointage assisté : seulement pour quelqu'un qui conduit aussi.
    appUser.conduit && enabledModules.includes("time_clock")
      ? supabase
          .from("organizations")
          .select("auto_clock_enabled")
          .eq("id", appUser.organization_id)
          .single()
          .then((r) => Boolean(r.data?.auto_clock_enabled))
      : Promise.resolve(false),
  ]);

  const maintenant = new Date();
  const equipe = donnees.equipe.data;
  const vehicules = donnees.vehicules.data;
  const cEquipe = compterEquipe(equipe);
  const cVehicules = compterVehicules(vehicules);
  const moi = { id: appUser.id, role: "manager", serviceIds: donnees.serviceIds };
  const dossiersOuverts = (donnees.amendes?.data.length ?? 0) + (donnees.contestations?.data.length ?? 0);
  const afficheDossiers = Boolean(donnees.amendes || donnees.contestations);

  const tuiles = [
    { libelle: "En tournée", valeur: String(cEquipe.enTournee), accent: "teal" as const, ancre: "#equipe" },
    { libelle: "Disponibles", valeur: String(cEquipe.disponibles), accent: "teal" as const, ancre: "#equipe" },
    { libelle: "Absents", valeur: String(cEquipe.absents), accent: "gold" as const, ancre: "#equipe" },
    afficheDossiers && { libelle: "Amendes et contestations ouvertes", valeur: String(dossiersOuverts), accent: dossiersOuverts > 0 ? ("orange" as const) : ("teal" as const), ancre: "#amendes" },
  ].filter(Boolean) as { libelle: string; valeur: string; accent: "teal" | "orange" | "gold"; ancre: string }[];

  return (
    <div>
      <PageHeader title={`Bonjour ${appUser.full_name.split(" ")[0] ?? ""}`} description="Votre équipe et vos services en un coup d'œil." />
      {autoClock && <AssistedClock hasOpenTour={Boolean(tourneeOuverte)} />}

      {tourneeOuvrable && (
        <div className="mb-6">
          <TourHeroCard openTour={tourneeOuverte} />
        </div>
      )}

      {donnees.sansService ? (
        <Card className="mb-6">
          <h2 className="mb-2 text-lg">Aucun service rattaché</h2>
          <p className="text-sm text-navy/65">Votre compte n'est rattaché à aucun service : demandez à l'exploitation ou à la direction de vous affecter à votre équipe.</p>
        </Card>
      ) : (
        <>
          <div className={`mb-6 grid grid-cols-2 gap-3 sm:gap-4 ${tuiles.length > 3 ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
            {tuiles.map((t) => (
              <a key={t.libelle} href={t.ancre} className="block min-h-[44px]">
                <StatTile label={t.libelle} value={t.valeur} accent={t.accent} />
              </a>
            ))}
          </div>

          {/* Demandes de l'équipe, retards et tournées à pourvoir : la liste « À traiter », limitée à vos services. */}
          <Suspense fallback={<ATraiterAttente />}>
            <ATraiterBloc appUser={appUser} enabledModules={enabledModules} />
          </Suspense>

          <div className="flex flex-col gap-6">
            <Section id="equipe" titre="Mon équipe" resume={equipe.length > 0 ? resumeEquipe(cEquipe) : null} source={donnees.equipe}>
              {equipe.length === 0 ? (
                <p className="text-sm text-navy/60">Aucun membre actif dans vos services.</p>
              ) : (
                <>
                  <ul className="flex flex-col gap-2 text-sm">
                    {plafonner(equipe, equipeOuverte ? COURT + 2 : LONG).vus.map((m) => {
                      const contenu = (
                        <>
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{m.nom}</span>
                            {(m.tournee || m.immatriculation) && (
                              <span className="block truncate text-xs text-navy/60">
                                {m.tournee ? `Tournée ${m.tournee}` : ""}
                                {m.tournee && m.immatriculation ? " · " : ""}
                                {m.immatriculation ?? ""}
                              </span>
                            )}
                          </span>
                          <span className={BADGE_MEMBRE[m.etat]}>{LIBELLE_ETAT_MEMBRE[m.etat]}</span>
                        </>
                      );
                      return (
                        <li key={m.id}>
                          {ficheOuverte ? (
                            <Link href={urlDe("equipe.utilisateur_fiche", { id: m.id })} className={LIGNE}>
                              {contenu}
                            </Link>
                          ) : (
                            <div className={LIGNE}>{contenu}</div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <Reste total={equipe.length} montres={equipeOuverte ? COURT + 2 : LONG} href={equipeOuverte ? urlDe("equipe.utilisateurs") : null} libelle="Voir toute l'équipe" />
                </>
              )}
            </Section>

            <Section
              id="vehicules"
              titre="Véhicules de mon service"
              resume={vehicules.length > 0 ? `${cVehicules.total} véhicule${cVehicules.total > 1 ? "s" : ""} · ${cVehicules.enTournee} en tournée · ${cVehicules.disponibles} disponible${cVehicules.disponibles > 1 ? "s" : ""}${cVehicules.entretien ? ` · ${cVehicules.entretien} en entretien` : ""}${cVehicules.asurveiller ? ` · ${cVehicules.asurveiller} à surveiller` : ""}` : null}
              source={donnees.vehicules}
            >
              {vehicules.length === 0 ? (
                <p className="text-sm text-navy/60">Aucun véhicule dans vos services.</p>
              ) : (
                <>
                  <ul className="flex flex-col gap-2 text-sm">
                    {plafonner(vehicules, flotteOuverte ? COURT : LONG).vus.map((v) => {
                      const contenu = (
                        <>
                          <span className="min-w-0">
                            <span className="block truncate font-medium">
                              {v.immatriculation}
                              {v.type ? <span className="ml-2 text-xs font-normal text-navy/60">{v.type}</span> : null}
                            </span>
                            {v.chauffeur && <span className="block truncate text-xs text-navy/60">avec {v.chauffeur}</span>}
                            {v.motif && <span className="block text-xs text-orange-ink">À surveiller : {v.motif}</span>}
                          </span>
                          <span className="flex shrink-0 flex-col items-end gap-1">
                            <span className={BADGE_VEHICULE[v.etat]}>{LIBELLE_ETAT_VEHICULE[v.etat]}</span>
                            {v.asurveiller && <span className="badge-gold">À surveiller</span>}
                          </span>
                        </>
                      );
                      return (
                        <li key={v.id}>
                          {ficheVehiculeOuverte ? (
                            <Link href={urlDe("flotte.vehicule_fiche", { id: v.id })} className={LIGNE}>
                              {contenu}
                            </Link>
                          ) : (
                            <div className={LIGNE}>{contenu}</div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <Reste total={vehicules.length} montres={flotteOuverte ? COURT : LONG} href={flotteOuverte ? urlDe("flotte.vehicules") : null} libelle="Voir la flotte" />
                </>
              )}
            </Section>

            {afficheDossiers && (
              <section id="amendes" aria-labelledby="titre-amendes" className="scroll-mt-4">
                <h2 id="titre-amendes" className="mb-3 text-lg">
                  Amendes et contestations
                </h2>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {donnees.amendes && (
                    <Dossiers
                      titre="Amendes ouvertes"
                      vide="Aucune amende ouverte"
                      source={donnees.amendes}
                      libellesStatut={LIBELLE_STATUT_AMENDE}
                      maintenant={maintenant}
                      moi={moi}
                      lien={(d) => `${urlDe("flotte.amendes")}?amende=${encodeURIComponent(d.id)}`}
                      ouvert={amendesOuvertes}
                      voirTout={urlDe("flotte.amendes")}
                    />
                  )}
                  {donnees.contestations && (
                    <Dossiers
                      titre="Contestations ouvertes"
                      vide="Aucune contestation ouverte"
                      source={donnees.contestations}
                      libellesStatut={LIBELLE_STATUT_CONTESTATION}
                      maintenant={maintenant}
                      moi={moi}
                      lien={(d) => `${urlDe("exploitation.contestations")}?fiche=${encodeURIComponent(d.id)}`}
                      ouvert={contestationsOuvertes}
                      voirTout={urlDe("exploitation.contestations")}
                    />
                  )}
                </div>
              </section>
            )}
          </div>
        </>
      )}

      <section id="notifications" aria-labelledby="titre-notifications" className="mt-6 scroll-mt-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="titre-notifications" className="text-lg">
            Notifications
          </h2>
          <Link href={urlDe("communication.alertes")} className={LIEN_VOIR_TOUT}>
            Voir toutes
          </Link>
        </div>
        {alertesLues.erreur ? (
          <p className="text-xs text-navy/55">Notifications momentanément indisponibles.</p>
        ) : alertesLues.alertes.length === 0 ? (
          <p className="text-sm text-navy/60">Aucune notification signalée par l'exploitation ou la direction.</p>
        ) : (
          <AlertList alerts={alertesLues.alertes} viewerRole={appUser.role} conduit={appUser.conduit} modules={enabledModules} />
        )}
      </section>

      {appUser.conduit && (
        <div className="mt-8">
          <QrCodeBadge type="driver" id={appUser.id} title={appUser.full_name} subtitle="Mon badge chauffeur — à présenter à la pompe" />
        </div>
      )}
    </div>
  );
}

/** Section empilée : en-tête clair, résumé, message discret si la source a échoué. */
function Section({ id, titre, resume, source, children }: { id: string; titre: string; resume: string | null; source: Source<unknown>; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`titre-${id}`} className="scroll-mt-4">
      <Card>
        <h2 id={`titre-${id}`} className="text-lg">
          {titre}
        </h2>
        {resume && <p className="mb-3 mt-1 text-sm text-navy/65">{resume}</p>}
        {!resume && <div className="mb-3" />}
        {source.erreur && <p className="mb-2 text-xs text-navy/55">Certaines informations sont momentanément indisponibles.</p>}
        {children}
      </Card>
    </section>
  );
}

/** « Voir tout » (si un écran s'ouvre) ou simple mention du reste. */
function Reste({ total, montres, href, libelle }: { total: number; montres: number; href: string | null; libelle: string }) {
  const reste = Math.max(0, total - montres);
  if (!href && reste === 0) return null;
  return (
    <div className="mt-2 flex items-center justify-between gap-3">
      <span className="text-xs text-navy/60">{reste > 0 ? `+ ${reste} autre${reste > 1 ? "s" : ""}` : ""}</span>
      {href && (
        <Link href={href} className={LIEN_VOIR_TOUT}>
          {libelle}
        </Link>
      )}
    </div>
  );
}

/** Courte liste d'amendes ou de contestations ouvertes, les plus anciennes d'abord. */
function Dossiers<T extends DossierOuvert>({
  titre,
  vide,
  source,
  libellesStatut,
  maintenant,
  moi,
  lien,
  ouvert,
  voirTout,
}: {
  titre: string;
  vide: string;
  source: Source<T[]>;
  libellesStatut: Record<string, string>;
  maintenant: Date;
  moi: { id: string; role: string; serviceIds: string[] };
  lien: (d: T) => string;
  ouvert: boolean;
  voirTout: string;
}) {
  const tries = trierParAnciennete(source.data);
  const { vus } = plafonner(tries, COURT - 2);
  return (
    <Card>
      <h3 className="text-base font-semibold">
        {titre} <span className="text-navy/60">({source.data.length}{source.tronquee ? "+" : ""})</span>
      </h3>
      {source.erreur && <p className="mt-1 text-xs text-navy/55">Certaines informations sont momentanément indisponibles.</p>}
      {source.data.length === 0 ? (
        <p className="mt-3 text-sm text-navy/60">{vide}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {vus.map((d) => {
            const mention = mentionHierarchie({ moi, dossier: d });
            const age = libelleAnciennete(ancienneteJours(d.date, maintenant));
            const contenu = (
              <>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{d.intitule}</span>
                  <span className="block truncate text-xs text-navy/60">
                    {d.personne ? `${d.personne} · ` : ""}
                    {d.date ? `${dateParis(d.date)}${age ? ` (${age})` : ""}` : ""}
                  </span>
                  {mention && <span className="block text-xs text-navy/70">{d.personneId === moi.id ? `Vous êtes concerné — ${mention.replace(/^Votre demande — /, "")}` : mention}</span>}
                </span>
                <span className="badge-neutral shrink-0">{libellesStatut[d.statut] ?? d.statut}</span>
              </>
            );
            return (
              <li key={d.id}>
                {ouvert ? (
                  <Link href={lien(d)} className={LIGNE}>
                    {contenu}
                  </Link>
                ) : (
                  <div className={LIGNE}>{contenu}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Reste total={source.data.length} montres={COURT - 2} href={ouvert ? voirTout : null} libelle="Voir tout" />
    </Card>
  );
}
