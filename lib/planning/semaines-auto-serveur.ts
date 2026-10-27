import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { journaliser } from "@/lib/audit/journal";
import { estPoleBureau } from "@/lib/organization/poles";
import { estSchemaManquant, estValeurEnumInconnue } from "@/lib/rattachement/tolerance";
import { minuitParis } from "@/lib/ticpe/export";
import { addDays, parisWallTimeToUtcISOString } from "@/lib/planning/dates";
import { lireAbsences } from "@/lib/planning/absences";
import { cleSemaine, periodePublication } from "@/lib/planning/publication";
import { publierSemaines } from "@/lib/planning/publication-serveur";
import { clesTourneeJour, marquerFusionnees } from "@/lib/planning/fusion-verrou";
import { doublonsDeLaSemaine, lireVerrous, verrousDeLaPeriode } from "@/lib/planning/fusion-verrou-serveur";
import { cloreAlertesPlanning, lireSuivi, libererPublication, reserverPublication, reserverRappel } from "@/lib/planning/suivi-auto-serveur";
import type { AffectationPlanning } from "@/lib/planning/semaine";
import {
  CHAMPS_SUIVI,
  ROLES_DESTINATAIRES_PLANNING,
  casesSansChauffeur,
  cleAlerteEnvoi,
  cleAlerteGeneration,
  cleAlerteRappel,
  cleLigne,
  choisirSemaineSource,
  cumulerResumes,
  decisionEnvoiAuto,
  envoiAutomatiquePrevu,
  instantParis,
  lireResume,
  lundisAvecAffectations,
  messageEnvoiAuto,
  messageGeneration,
  messageRappelDoublonFusion,
  messageRappelModifie,
  MESSAGE_SANS_SOURCE,
  SEMAINES_SOURCE_MAX,
  planifierSemaineSuivante,
  resumeDesLignes,
  semaineSuivante,
  verdictConfirmation,
  type CaseAbsente,
  type ContexteAbsences,
  type LigneAGenerer,
  type LigneSuivi,
  type ModeleGeneration,
  type ResumeSemaine,
} from "@/lib/planning/semaines-auto";

/**
 * Génération, confirmation et envoi automatique du planning de la semaine
 * suivante (flux décrit dans lib/planning/semaines-auto.ts). Client service
 * role : les rôles sont vérifiés par les routes et les crons AU-DESSUS.
 * Tout est tolérant à une migration non appliquée (estSchemaManquant) : la
 * génération est alors sautée avec un message, jamais d'erreur.
 */

type Db = SupabaseClient;

export const MESSAGE_MIGRATION_MANQUANTE = "Suivi des semaines générées indisponible : migration 20261111000001_planning_semaines_auto.sql pas encore appliquée. Génération sautée.";

const un = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

// ---------------------------------------------------------------------------
// Lectures.
// ---------------------------------------------------------------------------

const CHAMPS_LIGNE = "id, service_id, tour_number, driver_id, vehicle_id, start_at, status";

/** Lignes du planning entre deux instants (hors présences du bureau), par pages de 1000. Sans la colonne tour_open : toutes ouvertes. */
export async function lireLignesPlanning(db: Db, organizationId: string, depuis: string, avant: string, serviceId?: string): Promise<AffectationPlanning[]> {
  let champs = `${CHAMPS_LIGNE}, tour_open`;
  const out: AffectationPlanning[] = [];
  for (let page = 0; page < 30; page++) {
    const lire = (c: string) => {
      let q = db.from("planning_entries").select(c).eq("organization_id", organizationId).neq("status", "presence").gte("start_at", depuis).lt("start_at", avant);
      if (serviceId) q = q.eq("service_id", serviceId);
      return q.order("start_at").order("id").range(page * 1000, page * 1000 + 999);
    };
    let { data, error } = await lire(champs);
    if (error && champs !== CHAMPS_LIGNE && estSchemaManquant(error)) {
      champs = CHAMPS_LIGNE;
      ({ data, error } = await lire(champs));
    }
    if (error) throw new Error(`planning : ${error.message}`);
    out.push(...((data ?? []) as unknown as AffectationPlanning[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Modèles de tournées actifs, par service (table ou colonnes absentes : aucun modèle). */
async function lireModeles(db: Db, organizationId: string): Promise<ModeleGeneration[]> {
  const { data, error } = await db
    .from("planning_tour_templates")
    .select("service_id, departure_time, weekdays, default_vehicle_id, tour_routes(tour_number)")
    .eq("organization_id", organizationId)
    .eq("active", true);
  if (error) {
    if (!estSchemaManquant(error)) console.warn("[planning/auto] Modèles non lus", error.message);
    return [];
  }
  return ((data ?? []) as any[])
    .map((t) => ({ service_id: t.service_id as string, tour_number: un<{ tour_number: string }>(t.tour_routes)?.tour_number ?? "", departure_time: String(t.departure_time), weekdays: (t.weekdays ?? []) as number[], default_vehicle_id: (t.default_vehicle_id ?? null) as string | null }))
    .filter((m) => m.tour_number);
}

/** Absences de la semaine cible, comptes inactifs et sorties des chauffeurs recopiés, et leurs noms. */
async function lireContexte(db: Db, organizationId: string, du: string, au: string, driverIds: readonly string[]): Promise<{ contexte: ContexteAbsences; noms: Map<string, string> }> {
  const absences = await lireAbsences(db, organizationId, du, au);
  const noms = new Map<string, string>();
  const inactifs = new Set<string>();
  const sorties = new Map<string, string>();
  const ids = [...new Set(driverIds)];
  for (let i = 0; i < ids.length; i += 100) {
    const lot = ids.slice(i, i + 100);
    const { data: users, error } = await db.from("users").select("id, full_name, active").eq("organization_id", organizationId).in("id", lot);
    if (error) console.warn("[planning/auto] Chauffeurs non lus", error.message);
    for (const u of (users ?? []) as { id: string; full_name: string | null; active: boolean | null }[]) {
      noms.set(u.id, u.full_name?.trim() || "Chauffeur");
      if (u.active === false) inactifs.add(u.id);
    }
    const { data: dossiers, error: erreurDossiers } = await db.from("employee_files").select("user_id, exit_date").eq("organization_id", organizationId).in("user_id", lot).not("exit_date", "is", null);
    if (erreurDossiers && !estSchemaManquant(erreurDossiers)) console.warn("[planning/auto] Dates de sortie non lues", erreurDossiers.message);
    for (const d of (dossiers ?? []) as { user_id: string; exit_date: string }[]) sorties.set(d.user_id, d.exit_date);
  }
  return { contexte: { conges: absences.conges, arrets: absences.arrets, inactifs, sorties }, noms };
}

// ---------------------------------------------------------------------------
// Alertes d'encadrement.
// ---------------------------------------------------------------------------

export type ResultatAlerte = "creee" | "deja" | "type_absent" | "erreur";

/**
 * Alerte « planning à confirmer » (cloche, push et e-mail par le webhook des
 * alertes) pour la direction, l'exploitation et les managers du service. Une
 * par clé : l'index unique alerts_cle_dedoublonnage_unique ignore un doublon.
 * Type d'alerte absent (migration 20261111000002) : aucune alerte, le bandeau
 * et « À traiter » lisent le suivi directement.
 */
async function creerAlerte(admin: Db, p: { organizationId: string; serviceId: string; ligneId: string; severity: "info" | "warning" | "critical"; message: string; cle: string }): Promise<ResultatAlerte> {
  const ligne = {
    organization_id: p.organizationId,
    type: "planning_a_confirmer",
    severity: p.severity,
    message: p.message,
    related_table: "planning_semaines_auto",
    related_id: p.ligneId,
    recipient_roles: [...ROLES_DESTINATAIRES_PLANNING],
    service_id: p.serviceId,
  };
  let { error } = await admin.from("alerts").insert({ ...ligne, cle_dedoublonnage: p.cle });
  // Colonne de dédoublonnage absente (migration 20261108000002) : création sans clé, le suivi garantit l'unicité.
  if (error && estSchemaManquant(error)) ({ error } = await admin.from("alerts").insert(ligne));
  if (!error) return "creee";
  if (error.code === "23505") return "deja";
  if (estValeurEnumInconnue(error)) return "type_absent";
  console.error("[planning/auto] Alerte non créée", error.message);
  return "erreur";
}

// ---------------------------------------------------------------------------
// Génération.
// ---------------------------------------------------------------------------

export interface BilanService {
  serviceId: string;
  service: string;
  statut: "generee" | "regeneree" | "deja" | "publiee" | "rien" | "erreur";
  resume?: ResumeSemaine;
  /** Lundi de la semaine recopiée. */
  source?: string;
  /** Lignes créées par cette exécution. */
  creees?: number;
  message?: string;
  alerte?: ResultatAlerte;
}

export interface BilanGeneration {
  lundi: string;
  migrationManquante: boolean;
  message?: string;
  services: BilanService[];
}

/**
 * Génère la semaine commençant `lundi` pour les services d'une organisation (ou
 * un seul), SANS rien écraser. Le jeudi (cron), la source est la semaine
 * précédente. À la demande (`manuel`, ou `regenerer`), c'est la semaine la plus
 * proche avant la cible qui a des affectations, au plus SEMAINES_SOURCE_MAX
 * semaines en arrière (lib/planning/semaines-auto.ts › choisirSemaineSource) :
 *  - une ligne planning_semaines_auto par service bloque une seconde génération
 *    (sauf `regenerer` : « Régénérer les cases vides », qui ne crée que ce qui manque) ;
 *  - semaine déjà publiée pour le service : rien ;
 *  - planning déjà commencé à la main : seules les cases vides sont remplies et
 *    la semaine est notée « modifiée » (jamais envoyée toute seule).
 * Les lignes créées sont non publiées : invisibles des chauffeurs (RLS, migration
 * 20261111000001) et sans notification pour eux (trigger muet tant que la semaine
 * n'est pas dans planning_validations).
 */
export async function genererSemaine(
  admin: Db,
  organizationId: string,
  p: {
    lundi: string;
    serviceId?: string;
    regenerer?: boolean;
    userId?: string | null;
    /** Génération à la demande (« Générer le planning de la semaine du … ») : genere_par = 'manuel', source cherchée en arrière. */
    manuel?: boolean;
    /** Horloge injectable pour les tests. */
    maintenant?: Date;
  },
): Promise<BilanGeneration> {
  const lundi = p.lundi;
  const chercherSource = Boolean(p.manuel || p.regenerer);
  const lundiPrecedent = addDays(lundi, -7);
  const bilan: BilanGeneration = { lundi, migrationManquante: false, services: [] };

  const suivi = await lireSuivi(admin, organizationId, { lundi });
  if (!suivi.ok) {
    if (suivi.tableAbsente) return { ...bilan, migrationManquante: true, message: MESSAGE_MIGRATION_MANQUANTE };
    throw new Error(`suivi : ${suivi.error}`);
  }
  const suiviParService = new Map(suivi.lignes.map((l) => [l.service_id, l]));

  const { data: services, error: erreurServices } = await admin.from("services").select("id, name, pole").eq("organization_id", organizationId).order("name");
  if (erreurServices) throw new Error(`services : ${erreurServices.message}`);
  const cibles = ((services ?? []) as { id: string; name: string; pole: string | null }[]).filter((s) => !estPoleBureau(s.pole) && (!p.serviceId || s.id === p.serviceId));
  if (!cibles.length) return bilan;

  const { data: validations } = await admin.from("planning_validations").select("service_id, week_start").eq("organization_id", organizationId).eq("week_start", lundi);
  const publiees = new Set(((validations ?? []) as { service_id: string; week_start: string }[]).map((v) => cleSemaine(v.service_id, v.week_start)));

  const [sources, cibleLues, modeles] = await Promise.all([
    lireLignesPlanning(admin, organizationId, minuitParis(chercherSource ? addDays(lundi, -7 * SEMAINES_SOURCE_MAX) : lundiPrecedent), minuitParis(lundi), p.serviceId),
    lireLignesPlanning(admin, organizationId, minuitParis(lundi), minuitParis(addDays(lundi, 7))),
    lireModeles(admin, organizationId),
  ]);
  const { contexte, noms } = await lireContexte(admin, organizationId, lundi, addDays(lundi, 6), sources.map((s) => s.driver_id).filter((id): id is string => Boolean(id)));

  for (const s of cibles) {
    const base = { serviceId: s.id, service: s.name };
    try {
      const ligne = suiviParService.get(s.id) ?? null;
      if (ligne && !p.regenerer) {
        bilan.services.push({ ...base, statut: "deja", message: "Semaine déjà générée pour ce service." });
        continue;
      }
      if (ligne?.publie_at || ligne?.confirme_at || publiees.has(cleSemaine(s.id, lundi))) {
        bilan.services.push({ ...base, statut: "publiee", message: "Semaine déjà publiée aux chauffeurs : rien n'est généré." });
        continue;
      }
      const existantes = cibleLues.filter((e) => e.service_id === s.id);
      const sourcesDuService = sources.filter((x) => x.service_id === s.id);
      const trouvee = chercherSource ? choisirSemaineSource(lundi, lundisAvecAffectations(sourcesDuService)) : lundiPrecedent;
      if (!trouvee && p.manuel && !ligne) {
        bilan.services.push({ ...base, statut: "rien", message: MESSAGE_SANS_SOURCE });
        continue;
      }
      const lundiSource = trouvee ?? lundiPrecedent;
      // Tournées d'origine d'une fusion (semaine source ou cible) : ni recopiées ni comblées par un modèle. Tolérant : sans fusion, vide.
      const { verrous } = await verrousDeLaPeriode(admin, organizationId, s.id, lundiSource, addDays(lundi, 6));
      const plan = planifierSemaineSuivante({
        lundiSource,
        lundiCible: lundi,
        sources: sourcesDuService,
        existantes,
        modeles: modeles.filter((m) => m.service_id === s.id),
        contexte,
        nomDe: (id) => noms.get(id) ?? "Chauffeur",
        fusionnees: clesTourneeJour(verrous, s.id),
      });
      if (!plan.lignes.length && !existantes.length && !ligne) {
        bilan.services.push({ ...base, statut: "rien", message: "Aucune tournée à recopier ni modèle actif." });
        continue;
      }

      // Réservation : la ligne de suivi bloque une seconde exécution (et masque la semaine aux chauffeurs).
      let courante = ligne;
      let creeeIci = false;
      if (!courante) {
        const maintenant = new Date().toISOString();
        const creer = (genere_par: "auto" | "manuel") =>
          admin
            .from("planning_semaines_auto")
            .insert({ organization_id: organizationId, service_id: s.id, semaine_debut: lundi, genere_par, modifie_at: existantes.length ? maintenant : null, resume: plan.resume })
            .select(CHAMPS_SUIVI)
            .single();
        let { data: cree, error: erreurCreation } = await creer(p.manuel ? "manuel" : "auto");
        // Contrainte d'origine (genere_par in ('auto')) : migration 20261111000004 pas encore appliquée, on note « auto ».
        if (p.manuel && erreurCreation?.code === "23514") ({ data: cree, error: erreurCreation } = await creer("auto"));
        if (erreurCreation) {
          if (erreurCreation.code === "23505") {
            bilan.services.push({ ...base, statut: "deja", message: "Semaine générée par une autre exécution." });
            continue;
          }
          throw new Error(erreurCreation.message);
        }
        courante = cree as LigneSuivi;
        creeeIci = true;
      }

      // Insertion (créneau pris entre-temps : ignoré, jamais remplacé).
      const lignesBase = plan.lignes.map((l: LigneAGenerer) => ({ organization_id: organizationId, service_id: l.service_id, tour_number: l.tour_number, driver_id: l.driver_id, vehicle_id: l.vehicle_id, start_at: l.start_at, status: "planned" as const }));
      const inserees: { id: string; tour_number: string; start_at: string }[] = [];
      for (let i = 0; i < lignesBase.length; i += 400) {
        const { data, error } = await admin
          .from("planning_entries")
          .upsert(lignesBase.slice(i, i + 400), { onConflict: "organization_id,service_id,tour_number,start_at", ignoreDuplicates: true })
          .select("id, tour_number, start_at");
        if (error) {
          // Rien n'est annoncé : la réservation est levée pour que la génération puisse être relancée.
          if (creeeIci && !inserees.length) await admin.from("planning_semaines_auto").delete().eq("id", courante.id);
          throw new Error(error.message);
        }
        inserees.push(...((data ?? []) as { id: string; tour_number: string; start_at: string }[]));
      }

      const idParCle = new Map(inserees.map((e) => [cleLigne(e.tour_number, e.start_at), e.id]));
      const lignesCreees = plan.lignes.filter((l) => idParCle.has(cleLigne(l.tour_number, l.start_at)));
      const absents: CaseAbsente[] = plan.absents
        .map((a) => ({ ...a, entree_id: idParCle.get(cleLigne(a.tournee, parisWallTimeToUtcISOString(a.jour, a.heure))) ?? null }))
        .filter((a) => a.entree_id);
      const final = resumeDesLignes(lignesCreees, absents, { fermees: plan.resume.fermees, conflits: plan.resume.conflits, deja_presentes: plan.resume.deja_presentes, fusionnees: plan.resume.fusionnees });
      const resume = ligne ? cumulerResumes(lireResume(ligne.resume), final) : final;

      const maj: Record<string, unknown> = { resume };
      // Régénération : une action manuelle, la semaine est « modifiée » (pas d'envoi automatique).
      if (ligne && !ligne.modifie_at) maj.modifie_at = new Date().toISOString();
      const { error: erreurMaj } = await admin.from("planning_semaines_auto").update(maj).eq("id", courante.id);
      if (erreurMaj) console.warn("[planning/auto] Résumé non enregistré", erreurMaj.message);

      await journaliser({
        organizationId,
        userId: p.userId ?? null,
        action: ligne ? "planning_semaine_regeneree" : "planning_semaine_generee",
        targetTable: "planning_semaines_auto",
        targetId: courante.id,
        details: { service: s.id, semaine: lundi, creees: lignesCreees.length, chauffeurs: final.chauffeurs, a_remplacer: final.a_remplacer, fermees: final.fermees, conflits: final.conflits, deja_presentes: final.deja_presentes, fusionnees: final.fusionnees, mode: ligne ? "cases_vides" : p.manuel ? "manuel" : "auto", source: lundiSource },
      });

      // Génération à la demande : la personne qui a cliqué est prévenue par l'écran, personne d'autre.
      // Sauf pour la semaine suivante (N+1), qui partira toute seule le vendredi 17 h : l'encadrement doit le savoir.
      let alerte: ResultatAlerte | undefined;
      if (!ligne && (!p.manuel || envoiAutomatiquePrevu(lundi, instantParis(p.maintenant ?? new Date()).jour))) {
        alerte = await creerAlerte(admin, { organizationId, serviceId: s.id, ligneId: courante.id, severity: final.a_remplacer > 0 ? "warning" : "info", message: messageGeneration(lundi, resume, s.name), cle: cleAlerteGeneration(s.id, lundi) });
      }
      bilan.services.push({ ...base, statut: ligne ? "regeneree" : "generee", resume, creees: lignesCreees.length, source: lundiSource, alerte });
    } catch (e) {
      console.error("[planning/auto] Génération en erreur", s.name, e);
      bilan.services.push({ ...base, statut: "erreur", message: e instanceof Error ? e.message : String(e) });
    }
  }
  return bilan;
}

// ---------------------------------------------------------------------------
// Confirmation (bouton « Confirmer et envoyer aux chauffeurs »).
// ---------------------------------------------------------------------------

export type ResultatConfirmation =
  | { ok: true; sent: number; casesARemplacer: number }
  | { ok: false; status: number; error: string; code?: "cases_a_remplacer" | "deja_publiee"; casesARemplacer?: number };

/**
 * Publie tout de suite la semaine d'un service (même fonction que « Publier
 * aux chauffeurs »), avec notification de chaque chauffeur concerné. Refuse
 * s'il reste des cases à remplacer, sauf `envoyerQuandMeme`. `db` : client de
 * la personne connectée (RLS) ; `admin` : client service. Le rôle et le
 * périmètre (manager : son service) sont vérifiés par la route.
 */
export async function confirmerSemaine(p: { db: Db; admin: Db; organizationId: string; userId: string; ligne: LigneSuivi; envoyerQuandMeme: boolean }): Promise<ResultatConfirmation> {
  const { ligne } = p;
  if (ligne.publie_at || ligne.confirme_at) return { ok: false, status: 409, code: "deja_publiee", error: "Ce planning est déjà envoyé aux chauffeurs." };

  const periode = periodePublication(ligne.semaine_debut, addDays(ligne.semaine_debut, 6));
  let lignes: AffectationPlanning[];
  try {
    lignes = await lireLignesPlanning(p.db, p.organizationId, minuitParis(periode.debut), minuitParis(addDays(periode.fin, 1)), ligne.service_id);
  } catch (e) {
    return { ok: false, status: 500, error: e instanceof Error ? e.message : "Lecture du planning impossible." };
  }
  // Une tournée d'origine d'une fusion n'est pas une case à remplacer (lib/planning/fusion-verrou.ts).
  const verrous = await lireVerrous(p.db, p.organizationId, lignes);
  const casesARemplacer = casesSansChauffeur(marquerFusionnees(lignes, verrous).map((l) => ({ ...l, tour_open: l.tour_open }))).length;
  const verdict = verdictConfirmation({ casesARemplacer, envoyerQuandMeme: p.envoyerQuandMeme });
  if (!verdict.ok) return { ok: false, status: 409, code: verdict.code, error: verdict.message, casesARemplacer };

  if (!(await reserverPublication(p.admin, ligne.id, "manuel", p.userId))) return { ok: false, status: 409, code: "deja_publiee", error: "Ce planning vient d'être envoyé." };
  const r = await publierSemaines({ db: p.db, admin: p.admin, organizationId: p.organizationId, validateurId: p.userId, serviceIds: [ligne.service_id], debut: periode.debut, fin: periode.fin, mode: "manuel" });
  if (!r.ok) {
    // Rien n'est parti : la semaine redevient masquée et peut être confirmée de nouveau.
    if (!r.validee) await libererPublication(p.admin, ligne.id);
    return { ok: false, status: r.status, error: r.error };
  }
  const closes = await cloreAlertesPlanning(p.admin, p.organizationId, [ligne.id]);
  await journaliser({
    organizationId: p.organizationId,
    userId: p.userId,
    action: "planning_semaine_confirmee",
    targetTable: "planning_semaines_auto",
    targetId: ligne.id,
    details: { service: ligne.service_id, semaine: ligne.semaine_debut, chauffeurs_prevenus: r.sent, cases_a_remplacer: casesARemplacer, envoye_quand_meme: p.envoyerQuandMeme && casesARemplacer > 0, modifiee: Boolean(ligne.modifie_at), alertes_closes: closes },
  });
  return { ok: true, sent: r.sent, casesARemplacer };
}

// ---------------------------------------------------------------------------
// Envoi automatique du vendredi 17 h.
// ---------------------------------------------------------------------------

export interface BilanEnvoi {
  lundi: string;
  migrationManquante: boolean;
  /** Pas vendredi, ou avant 17:00 à Paris : rien n'est fait. */
  attente?: string;
  envoyees: number;
  rappels: number;
  ignorees: number;
  erreurs: string[];
}

/** Auteur de la publication automatique (planning_validations.validated_by est obligatoire) : la direction, à défaut l'exploitation. */
async function auteurPublicationAuto(admin: Db, organizationId: string): Promise<string | null> {
  for (const role of ["direction", "exploitation"]) {
    const { data } = await admin.from("users").select("id").eq("organization_id", organizationId).eq("role", role).eq("active", true).order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (data?.id) return data.id as string;
  }
  return null;
}

/**
 * Cron du vendredi, pour une organisation : SEULE la semaine suivante (N+1) est
 * envoyée automatiquement. Les semaines plus lointaines préparées à l'avance
 * (génération à la demande) ne sont jamais lues ici : elles attendent la
 * confirmation manuelle. Pour chaque service dont la semaine suivante a été générée et n'est ni confirmée ni publiée (decisionEnvoiAuto) :
 *  - intacte : publication automatique, même fonction que « Confirmer » ;
 *  - modifiée : rappel critique à l'encadrement, une seule fois ;
 *  - déjà publiée, ou avant 17:00 à Paris : rien. Idempotent.
 */
export async function envoyerSemainesAuto(admin: Db, organizationId: string, maintenant: Date): Promise<BilanEnvoi> {
  const t = instantParis(maintenant);
  const lundi = semaineSuivante(t.jour).lundi;
  const bilan: BilanEnvoi = { lundi, migrationManquante: false, envoyees: 0, rappels: 0, ignorees: 0, erreurs: [] };

  const suivi = await lireSuivi(admin, organizationId, { lundi });
  if (!suivi.ok) {
    if (suivi.tableAbsente) return { ...bilan, migrationManquante: true };
    throw new Error(`suivi : ${suivi.error}`);
  }
  const { data: services } = await admin.from("services").select("id, name").eq("organization_id", organizationId);
  const nomService = new Map(((services ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]));

  for (const ligne of suivi.lignes) {
    let decision = decisionEnvoiAuto({ ligne, maintenant });
    // Doublon de fusion (une tournée d'origine encore affectée) : pas d'envoi automatique, rappel à l'encadrement.
    let doublons = 0;
    if (decision.action === "publier" || decision.action === "rappeler") {
      doublons = (await doublonsDeLaSemaine(admin, organizationId, ligne.service_id, ligne.semaine_debut)).length;
      if (doublons > 0) decision = decisionEnvoiAuto({ ligne, maintenant, doublonsFusion: doublons });
    }
    if (decision.action === "rien") {
      bilan.ignorees++;
      if (decision.raison === "avant_17h" || decision.raison === "pas_vendredi") bilan.attente = decision.raison;
      continue;
    }
    const nom = nomService.get(ligne.service_id) ?? "Service";
    try {
      if (decision.action === "rappeler") {
        if (!(await reserverRappel(admin, ligne.id))) {
          bilan.ignorees++;
          continue;
        }
        const parDoublon = decision.motif === "doublon_fusion";
        await creerAlerte(admin, { organizationId, serviceId: ligne.service_id, ligneId: ligne.id, severity: "critical", message: parDoublon ? messageRappelDoublonFusion(ligne.semaine_debut, doublons, nom) : messageRappelModifie(ligne.semaine_debut, nom), cle: cleAlerteRappel(ligne.service_id, ligne.semaine_debut) });
        await journaliser({ organizationId, userId: null, action: "planning_semaine_rappel", targetTable: "planning_semaines_auto", targetId: ligne.id, details: { service: ligne.service_id, semaine: ligne.semaine_debut, ...(parDoublon ? { doublons_fusion: doublons } : {}) } });
        bilan.rappels++;
        continue;
      }

      const auteur = await auteurPublicationAuto(admin, organizationId);
      if (!auteur) {
        bilan.erreurs.push(`${nom} : aucun compte direction ou exploitation actif pour signer la publication.`);
        continue;
      }
      if (!(await reserverPublication(admin, ligne.id, "auto", null))) {
        bilan.ignorees++;
        continue;
      }
      const periode = periodePublication(ligne.semaine_debut, addDays(ligne.semaine_debut, 6));
      const r = await publierSemaines({ db: admin, admin, organizationId, validateurId: auteur, serviceIds: [ligne.service_id], debut: periode.debut, fin: periode.fin, mode: "auto" });
      if (!r.ok) {
        if (!r.validee) await libererPublication(admin, ligne.id);
        bilan.erreurs.push(`${nom} : ${r.error}`);
        continue;
      }
      await cloreAlertesPlanning(admin, organizationId, [ligne.id]);
      const restantes = lireResume(ligne.resume).a_remplacer;
      let aRemplacer = restantes;
      try {
        const lues = await lireLignesPlanning(admin, organizationId, minuitParis(periode.debut), minuitParis(addDays(periode.fin, 1)), ligne.service_id);
        aRemplacer = casesSansChauffeur(marquerFusionnees(lues, await lireVerrous(admin, organizationId, lues))).length;
      } catch {
        // Compte du résumé de génération, à défaut.
      }
      await creerAlerte(admin, { organizationId, serviceId: ligne.service_id, ligneId: ligne.id, severity: "info", message: messageEnvoiAuto(ligne.semaine_debut, aRemplacer, nom), cle: cleAlerteEnvoi(ligne.service_id, ligne.semaine_debut) });
      await journaliser({ organizationId, userId: null, action: "planning_semaine_envoyee_auto", targetTable: "planning_semaines_auto", targetId: ligne.id, details: { service: ligne.service_id, semaine: ligne.semaine_debut, chauffeurs_prevenus: r.sent, cases_a_remplacer: aRemplacer, signe_par: auteur } });
      bilan.envoyees++;
    } catch (e) {
      bilan.erreurs.push(`${nom} : ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return bilan;
}
