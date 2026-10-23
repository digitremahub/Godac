/**
 * Usage des comptes d'essai GO Navigation : calcul des indicateurs AGRÉGÉS
 * affichés au staff (app/godac-staff/usage-essais) et mise en forme du
 * détail réservé aux comptes qui ont donné leur accord.
 *
 * Logique pure (sans base) : les lignes sont lues côté serveur par
 * lib/go-navigation/usage-serveur.ts. RGPD : aucune des structures ci-dessous
 * ne porte de nom, d'adresse, de téléphone, de code colis ni de position GPS
 * de destinataire ; ne jamais en ajouter.
 */
import { joursRestants } from "@/lib/go-navigation/offre";

/** Fonctions comptées dans usage_events (lib/usage/quotas.ts). */
export const FEATURE_ETIQUETTE = "ocr_label";
export const FEATURE_OPTIMISATION = "route_optimization";

export interface OrgEssai {
  id: string;
  name: string;
  created_at: string;
  trial_ends_at: string | null;
  subscription_status: string | null;
  /** « Jean Dupont (Transports X) », déjà mis en forme. */
  apporteur: string | null;
  /** Dernière connexion (auth), tous utilisateurs de l'organisation confondus. */
  derniereConnexionAuth: string | null;
  /** Accord facultatif de partage du détail (faux si colonne absente). */
  accordDetail: boolean;
}

export interface TourneeBrute {
  id: string;
  organization_id: string;
  run_date: string;
  status: string;
  created_at: string;
  started_at: string | null;
  optimized_at: string | null;
}

export interface ArretBrut {
  organization_id: string;
  run_id: string;
  status: string;
  created_at: string;
  done_at: string | null;
}

export interface UsageBrut {
  organization_id: string;
  feature: string;
  units: number;
  created_at: string;
}

export interface LigneUsageEssai {
  id: string;
  nom: string;
  apporteur: string | null;
  inscritLe: string;
  joursRestants: number;
  essaiTermine: boolean;
  abonne: boolean;
  derniereActivite: string | null;
  tourneesCreees: number;
  tourneesDemarrees: number;
  tourneesCloturees: number;
  arrets: number;
  arretsLivres: number;
  arretsEchec: number;
  /** Arrêts créés après le démarrage de leur tournée (adresses ajoutées en cours de route). */
  arretsAjoutesEnTournee: number;
  optimisations: number;
  lecturesEtiquettes: number;
  recommandations: number;
  utilise: boolean;
  accordDetail: boolean;
}

export interface EtapeEntonnoir {
  cle: "inscrits" | "tournee_creee" | "tournee_demarree" | "a_livre" | "a_recommande";
  libelle: string;
  nombre: number;
  /** Part des inscrits, en %, null si aucun inscrit. */
  pourcentage: number | null;
}

export interface SyntheseUsage {
  inscrits: number;
  actifs: number;
  utilises: number;
  /** Tournées démarrées / tournées créées, en %. */
  tauxTourneesDemarrees: number | null;
  /** Arrêts livrés / (livrés + échecs), en %. */
  tauxLivraison: number | null;
  /** Tournées démarrées par essai utilisé (1 décimale). */
  tourneesDemarreesParEssaiUtilise: number | null;
  entonnoir: EtapeEntonnoir[];
}

export function pourcentage(n: number, d: number): number | null {
  return d > 0 ? Math.round((n / d) * 100) : null;
}

function moyenne(n: number, d: number): number | null {
  return d > 0 ? Math.round((n / d) * 10) / 10 : null;
}

const instant = (v: string | null | undefined) => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

function plusRecent(a: string | null, b: string | null): string | null {
  const ta = instant(a);
  const tb = instant(b);
  if (ta === null) return tb === null ? null : b;
  if (tb === null) return a;
  return tb > ta ? b : a;
}

function pousser<T>(m: Map<string, T[]>, cle: string, v: T) {
  const l = m.get(cle);
  if (l) l.push(v);
  else m.set(cle, [v]);
}

/**
 * Une ligne par organisation d'essai. `recommandations` : nombre de
 * recommandations d'employeur envoyées (employer_referrals.referrer_org_id).
 */
export function calculerLignes(
  orgs: readonly OrgEssai[],
  donnees: { tournees: readonly TourneeBrute[]; arrets: readonly ArretBrut[]; usages: readonly UsageBrut[]; recommandations: ReadonlyMap<string, number> },
  maintenant: Date = new Date(),
): LigneUsageEssai[] {
  const tourneesParOrg = new Map<string, TourneeBrute[]>();
  const arretsParOrg = new Map<string, ArretBrut[]>();
  const usagesParOrg = new Map<string, UsageBrut[]>();
  for (const t of donnees.tournees) pousser(tourneesParOrg, t.organization_id, t);
  for (const a of donnees.arrets) pousser(arretsParOrg, a.organization_id, a);
  for (const u of donnees.usages) pousser(usagesParOrg, u.organization_id, u);

  return orgs.map((o) => {
    const tournees = tourneesParOrg.get(o.id) ?? [];
    const arrets = arretsParOrg.get(o.id) ?? [];
    const usages = usagesParOrg.get(o.id) ?? [];
    const demarrageParTournee = new Map<string, number>();
    for (const t of tournees) {
      const d = instant(t.started_at);
      if (d !== null) demarrageParTournee.set(t.id, d);
    }

    let derniere: string | null = o.derniereConnexionAuth;
    for (const t of tournees) derniere = plusRecent(plusRecent(derniere, t.created_at), t.started_at);
    for (const a of arrets) derniere = plusRecent(plusRecent(derniere, a.created_at), a.done_at);
    for (const u of usages) derniere = plusRecent(derniere, u.created_at);

    const abonne = o.subscription_status === "active";
    const jours = joursRestants(o.trial_ends_at, maintenant);
    const termine = !abonne && jours === 0;
    const optimisations = usages.filter((u) => u.feature === FEATURE_OPTIMISATION).reduce((s, u) => s + u.units, 0);
    const lecturesEtiquettes = usages.filter((u) => u.feature === FEATURE_ETIQUETTE).reduce((s, u) => s + u.units, 0);
    const livres = arrets.filter((a) => a.status === "delivered").length;
    const recommandations = donnees.recommandations.get(o.id) ?? 0;
    const ajoutes = arrets.filter((a) => {
      const d = demarrageParTournee.get(a.run_id);
      const c = instant(a.created_at);
      return d !== undefined && c !== null && c > d;
    }).length;

    return {
      id: o.id,
      nom: o.name,
      apporteur: o.apporteur,
      inscritLe: o.created_at,
      joursRestants: jours,
      essaiTermine: termine,
      abonne,
      derniereActivite: derniere,
      tourneesCreees: tournees.length,
      tourneesDemarrees: demarrageParTournee.size,
      tourneesCloturees: tournees.filter((t) => t.status === "done").length,
      arrets: arrets.length,
      arretsLivres: livres,
      arretsEchec: arrets.filter((a) => a.status === "failed").length,
      arretsAjoutesEnTournee: ajoutes,
      optimisations,
      lecturesEtiquettes,
      recommandations,
      utilise: tournees.length > 0 || arrets.length > 0 || optimisations > 0 || lecturesEtiquettes > 0,
      accordDetail: o.accordDetail,
    };
  });
}

/** Totaux, moyennes et entonnoir (chaque étape compte les organisations qui l'ont atteinte, sans exiger les précédentes). */
export function synthetiser(lignes: readonly LigneUsageEssai[]): SyntheseUsage {
  const inscrits = lignes.length;
  const creees = lignes.reduce((s, l) => s + l.tourneesCreees, 0);
  const demarrees = lignes.reduce((s, l) => s + l.tourneesDemarrees, 0);
  const livres = lignes.reduce((s, l) => s + l.arretsLivres, 0);
  const echecs = lignes.reduce((s, l) => s + l.arretsEchec, 0);
  const utilises = lignes.filter((l) => l.utilise).length;
  const compte = (f: (l: LigneUsageEssai) => boolean) => lignes.filter(f).length;
  const etape = (cle: EtapeEntonnoir["cle"], libelle: string, nombre: number): EtapeEntonnoir => ({ cle, libelle, nombre, pourcentage: pourcentage(nombre, inscrits) });
  return {
    inscrits,
    actifs: compte((l) => !l.essaiTermine),
    utilises,
    tauxTourneesDemarrees: pourcentage(demarrees, creees),
    tauxLivraison: pourcentage(livres, livres + echecs),
    tourneesDemarreesParEssaiUtilise: moyenne(demarrees, utilises),
    entonnoir: [
      etape("inscrits", "Inscrits", inscrits),
      etape("tournee_creee", "Ont créé une tournée", compte((l) => l.tourneesCreees > 0)),
      etape("tournee_demarree", "Ont démarré une tournée", compte((l) => l.tourneesDemarrees > 0)),
      etape("a_livre", "Ont livré au moins un arrêt", compte((l) => l.arretsLivres > 0)),
      etape("a_recommande", "Ont recommandé un employeur", compte((l) => l.recommandations > 0)),
    ],
  };
}

// ── Libellés ────────────────────────────────────────────────────────

/** « 12 jours restants », « 1 jour restant », « Essai terminé » ou « Abonné ». */
export function libelleEssai(l: Pick<LigneUsageEssai, "joursRestants" | "essaiTermine" | "abonne">): string {
  if (l.abonne) return "Abonné";
  if (l.essaiTermine) return "Essai terminé";
  return `${l.joursRestants} ${l.joursRestants > 1 ? "jours restants" : "jour restant"}`;
}

/** « 62 % » ou « — ». */
export function libellePourcentage(p: number | null): string {
  return p === null ? "—" : `${p} %`;
}

/** Libellés des événements d'arrêt (delivery_stop_events.event_type) : jamais le contenu des notes ni des valeurs. */
export const LIBELLES_EVENEMENT_ARRET: Record<string, string> = {
  stop_created: "Arrêt ajouté",
  status_changed: "Statut d'un arrêt modifié",
  delivered: "Arrêt livré",
  failed: "Arrêt en échec",
  reopened: "Arrêt rouvert",
  reordered: "Ordre des arrêts modifié",
  list_changed: "Liste modifiée",
  pickup_count_recorded: "Ramasse comptée",
  delivery_count_recorded: "Livraison comptée",
  sms_prepared: "SMS préparé",
  sms_confirmed_sent: "SMS envoyé",
  call_started: "Appel lancé",
  call_confirmed: "Appel confirmé",
  note: "Note ajoutée",
};

export const LIBELLES_FONCTION_USAGE: Record<string, string> = {
  [FEATURE_ETIQUETTE]: "Lecture d'étiquette",
  [FEATURE_OPTIMISATION]: "Optimisation de tournée",
};

export function libelleEvenement(source: "arret" | "fonction", type: string): string {
  return (source === "arret" ? LIBELLES_EVENEMENT_ARRET : LIBELLES_FONCTION_USAGE)[type] ?? "Autre événement";
}

// ── Détail (avec accord seulement) ──────────────────────────────────

export interface LigneTournee {
  id: string;
  date: string;
  statut: string;
  arrets: number;
  livres: number;
  echecs: number;
  debut: string | null;
  /** Dernier arrêt traité (aucune heure de clôture n'est enregistrée) : approximation de la fin. */
  fin: string | null;
  dureeMinutes: number | null;
  optimisee: boolean;
}

export const LIBELLES_STATUT_TOURNEE: Record<string, string> = { loading: "En préparation", in_progress: "En cours", done: "Clôturée" };

/** Tournées de l'organisation, de la plus récente à la plus ancienne, avec les compteurs d'arrêts. */
export function detaillerTournees(tournees: readonly TourneeBrute[], arrets: readonly Pick<ArretBrut, "run_id" | "status" | "done_at">[]): LigneTournee[] {
  const parTournee = new Map<string, Pick<ArretBrut, "run_id" | "status" | "done_at">[]>();
  for (const a of arrets) pousser(parTournee, a.run_id, a);
  return [...tournees]
    .sort((a, b) => (a.run_date === b.run_date ? (instant(b.created_at) ?? 0) - (instant(a.created_at) ?? 0) : a.run_date < b.run_date ? 1 : -1))
    .map((t) => {
      const as = parTournee.get(t.id) ?? [];
      let fin: string | null = null;
      for (const a of as) fin = plusRecent(fin, a.done_at);
      const d = instant(t.started_at);
      const f = instant(fin);
      return {
        id: t.id,
        date: t.run_date,
        statut: t.status,
        arrets: as.length,
        livres: as.filter((a) => a.status === "delivered").length,
        echecs: as.filter((a) => a.status === "failed").length,
        debut: t.started_at,
        fin,
        dureeMinutes: d !== null && f !== null && f >= d ? Math.round((f - d) / 60000) : null,
        optimisee: Boolean(t.optimized_at),
      };
    });
}

/** « 2 h 05 » ou « 45 min ». */
export function libelleDuree(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
}

export interface EvenementUsage {
  at: string;
  libelle: string;
}

/** Chronologie fusionnée (type + horodatage seulement), la plus récente d'abord. */
export function chronologie(
  evenementsArret: readonly { event_type: string; created_at: string }[],
  usages: readonly { feature: string; units: number; created_at: string }[],
  limite = 300,
): EvenementUsage[] {
  const tous: EvenementUsage[] = [
    ...evenementsArret.map((e) => ({ at: e.created_at, libelle: libelleEvenement("arret", e.event_type) })),
    ...usages.map((u) => ({ at: u.created_at, libelle: `${libelleEvenement("fonction", u.feature)}${u.units > 1 ? ` (×${u.units})` : ""}` })),
  ];
  return tous.sort((a, b) => (instant(b.at) ?? 0) - (instant(a.at) ?? 0)).slice(0, limite);
}
