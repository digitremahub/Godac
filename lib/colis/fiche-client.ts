/**
 * Fiche client / établissement d'une organisation : ce que les tournées
 * précédentes ont appris d'une adresse (téléphone, contact, consignes d'accès,
 * fenêtre horaire, durée d'arrêt, créneau de réussite, motifs d'échec,
 * contacts déjà faits), pour des suggestions plus qualifiées.
 *
 * Elle étend l'annuaire existant (table delivery_address_hours, clé : adresse
 * normalisée) ; ce module est PUR (aucune base) et testé dans
 * lib/colis/__tests__/fiche-client.test.ts. L'enregistrement en base est dans
 * lib/colis/fiche-client-serveur.ts.
 *
 * Règles de mise à jour (une observation = un arrêt clôturé) :
 *  - jamais d'écrasement par une valeur vide : la DERNIÈRE valeur non vide gagne ;
 *  - la durée d'arrêt est une moyenne glissante bornée (au plus FENETRE_MOYENNE
 *    observations comptent), chaque observation étant elle-même bornée ;
 *  - les compteurs (livrés, échecs, créneaux, motifs, contacts) s'incrémentent
 *    et sont plafonnés ;
 *  - minimisation : seuls les établissements (nom d'entreprise connu) ou les
 *    adresses déjà dans l'annuaire sont retenus (voir retenirAdresse).
 */
import { distanceKm, type Point } from "@/lib/colis/optimisation";
import { MINUTES_PAR_ARRET, minutesTrajet } from "@/lib/colis/estimation";
import { MOTIFS_ECHEC, libelleMotif } from "@/lib/colis/cloture";
import { LIEUX_LIVRAISON } from "@/lib/colis/livraison";
import { lireHeure } from "@/lib/colis/horaires";

/** Bornes d'une durée d'arrêt observée (minutes). */
export const DUREE_SERVICE_MIN = 1;
export const DUREE_SERVICE_MAX = 30;
/** Nombre d'observations qui comptent dans la moyenne glissante. */
export const FENETRE_MOYENNE = 10;
/** Observations de durée nécessaires avant de remplacer la valeur fixe (3 min). */
export const ECHANTILLONS_DUREE_MIN = 2;
/** Écart maximal (min) entre deux clôtures successives pour en déduire une durée d'arrêt (au-delà : pause, autre mission). */
export const ECART_CLOTURE_MAX_MIN = 45;
/** Plafond de chaque compteur. */
export const COMPTEUR_MAX = 9999;
/** Échec « fréquent » : au moins 2 échecs ET au moins 40 % des passages. */
export const ECHECS_FREQUENTS_MIN = 2;
export const ECHECS_FREQUENTS_TAUX = 0.4;
/** Créneau de réussite : au moins 3 passages dans l'heure, dont 60 % de livraisons. */
export const CRENEAU_PASSAGES_MIN = 3;
export const CRENEAU_TAUX_MIN = 0.6;
/** Longueurs maximales stockées. */
export const LONGUEURS = { telephone: 40, destinataire: 120, consignes: 500, nom: 120 } as const;

export interface Reussite {
  ok: number;
  ko: number;
}

/** Données « client » d'une fiche de l'annuaire. */
export interface DonneesClient {
  label: string | null;
  phone: string | null;
  recipient: string | null;
  access_notes: string | null;
  lat: number | null;
  lng: number | null;
  window_start: string | null;
  window_end: string | null;
  service_avg_min: number | null;
  service_samples: number;
  delivered_count: number;
  failed_count: number;
  /** Heure de Paris (« 10 ») → livraisons réussies / échouées. */
  success_by_hour: Record<string, Reussite>;
  /** Motif d'échec → nombre. */
  failure_reasons: Record<string, number>;
  contact_message_count: number;
  contact_phone_count: number;
  last_delivery_at: string | null;
}

/** Ce que l'on retient d'un arrêt qui vient d'être clôturé. */
export interface ObservationArret {
  /** Nom de l'entreprise (business_name de l'arrêt). */
  nom?: string | null;
  telephone?: string | null;
  destinataire?: string | null;
  /** Consignes d'accès déjà épurées (consignesDepuisNotes). */
  consignes?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** Créneau ponctuel de l'arrêt (« 10:00:00 »). */
  fenetre?: { debut?: string | null; fin?: string | null } | null;
  statut: "delivered" | "failed";
  /** Motif d'échec (clé de MOTIFS_ECHEC). */
  motif?: string | null;
  /** Heure de la clôture, à Paris (0 à 23). */
  heure: number;
  /** Durée d'arrêt observée (min), null si inconnue. */
  dureeMin?: number | null;
  contactMessage?: boolean;
  contactTelephone?: boolean;
  /** Instant de la clôture (ISO). */
  quand: string;
}

// ── Outils ──────────────────────────────────────────────────────

const nettoyer = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

/** Dernière valeur non vide : la nouvelle si elle contient quelque chose, sinon l'ancienne. */
export function derniereNonVide(ancienne: string | null | undefined, nouvelle: string | null | undefined, max: number): string | null {
  return nettoyer(nouvelle, max) ?? nettoyer(ancienne, max);
}

const entier = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(COMPTEUR_MAX, Math.floor(v)) : 0);
const plus1 = (v: number): number => Math.min(COMPTEUR_MAX, v + 1);
const borne = (v: number): number => Math.min(DUREE_SERVICE_MAX, Math.max(DUREE_SERVICE_MIN, v));
const arrondi1 = (v: number): number => Math.round(v * 10) / 10;

/** Compteurs d'heures lus depuis le JSON stocké : clés « 0 » à « 23 », valeurs entières positives. */
export function lireReussites(v: unknown): Record<string, Reussite> {
  const out: Record<string, Reussite> = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [h, r] of Object.entries(v as Record<string, unknown>)) {
    if (!/^(?:[0-9]|1[0-9]|2[0-3])$/.test(h) || !r || typeof r !== "object") continue;
    const ok = entier((r as Reussite).ok);
    const ko = entier((r as Reussite).ko);
    if (ok + ko > 0) out[h] = { ok, ko };
  }
  return out;
}

const MOTIFS = new Set<string>(MOTIFS_ECHEC.map((m) => m.key));

/** Motifs d'échec lus depuis le JSON stocké (motifs connus seulement). */
export function lireMotifs(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [m, n] of Object.entries(v as Record<string, unknown>)) {
    const k = entier(n);
    if (MOTIFS.has(m) && k > 0) out[m] = k;
  }
  return out;
}

/** Fiche stockée (colonnes éventuellement absentes ou nulles) → données complètes et valides. */
export function lireDonnees(f: Record<string, unknown> | null | undefined): DonneesClient {
  const g = f ?? {};
  const nombre = (v: unknown): number | null => {
    const n = typeof v === "string" ? Number(v) : v;
    return typeof n === "number" && Number.isFinite(n) ? n : null;
  };
  const moyenne = nombre(g.service_avg_min);
  return {
    label: nettoyer(g.label, LONGUEURS.nom),
    phone: nettoyer(g.phone, LONGUEURS.telephone),
    recipient: nettoyer(g.recipient, LONGUEURS.destinataire),
    access_notes: nettoyer(g.access_notes, LONGUEURS.consignes),
    lat: nombre(g.lat),
    lng: nombre(g.lng),
    window_start: typeof g.window_start === "string" ? g.window_start : null,
    window_end: typeof g.window_end === "string" ? g.window_end : null,
    service_avg_min: moyenne !== null && moyenne > 0 ? borne(moyenne) : null,
    service_samples: entier(g.service_samples),
    delivered_count: entier(g.delivered_count),
    failed_count: entier(g.failed_count),
    success_by_hour: lireReussites(g.success_by_hour),
    failure_reasons: lireMotifs(g.failure_reasons),
    contact_message_count: entier(g.contact_message_count),
    contact_phone_count: entier(g.contact_phone_count),
    last_delivery_at: typeof g.last_delivery_at === "string" ? g.last_delivery_at : null,
  };
}

// ── Durée d'arrêt ───────────────────────────────────────────────

/**
 * Moyenne glissante bornée : la nouvelle observation (bornée à 1–30 min) pèse
 * 1/k, k = min(n + 1, FENETRE_MOYENNE) — au-delà de dix observations la moyenne
 * suit l'évolution récente au lieu de se figer.
 */
export function moyenneGlissante(moyenne: number | null | undefined, n: number, observation: number, fenetre: number = FENETRE_MOYENNE): number {
  const obs = borne(observation);
  if (moyenne === null || moyenne === undefined || !Number.isFinite(moyenne) || n <= 0) return arrondi1(obs);
  const k = Math.max(1, Math.min(n + 1, fenetre));
  return arrondi1(borne(moyenne + (obs - moyenne) / k));
}

/**
 * Durée d'arrêt déduite de deux clôtures successives de la même tournée :
 * l'écart entre elles, moins le trajet estimé entre les deux adresses. Nulle si
 * l'écart est incohérent (≤ 0, supérieur à ECART_CLOTURE_MAX_MIN) ou si le trajet
 * estimé dépasse l'écart (estimation trop imprécise pour apprendre quoi que ce soit).
 */
export function dureeObservee(
  precedente: { doneAt: string; point?: Point | null } | null | undefined,
  courante: { doneAt: string; point?: Point | null },
): number | null {
  if (!precedente) return null;
  const ecart = (Date.parse(courante.doneAt) - Date.parse(precedente.doneAt)) / 60_000;
  if (!Number.isFinite(ecart) || ecart <= 0 || ecart > ECART_CLOTURE_MAX_MIN) return null;
  const trajet = precedente.point && courante.point ? minutesTrajet(distanceKm(precedente.point, courante.point)) : 0;
  const duree = ecart - trajet;
  return duree < DUREE_SERVICE_MIN ? null : arrondi1(borne(duree));
}

/** Durée d'arrêt prévue : la moyenne observée si assez de passages, sinon la valeur fixe. */
export function dureeServicePrevue(f: { service_avg_min?: number | string | null; service_samples?: number | null } | null | undefined, defaut: number = MINUTES_PAR_ARRET): number {
  if (!f) return defaut;
  const moyenne = Number(f.service_avg_min);
  const n = f.service_samples ?? 0;
  if (!Number.isFinite(moyenne) || moyenne <= 0 || n < ECHANTILLONS_DUREE_MIN) return defaut;
  return borne(moyenne);
}

/** Durée d'arrêt observée (min) si elle est connue et fiable, sinon null (la valeur fixe s'applique alors). */
export function serviceConnu(f: { service_avg_min?: number | string | null; service_samples?: number | null } | null | undefined): number | null {
  const d = dureeServicePrevue(f, 0);
  return d > 0 ? d : null;
}

// ── Consignes ───────────────────────────────────────────────────

/**
 * Consignes d'accès tirées des notes d'un arrêt : les notes sans les mentions
 * que l'application y ajoute à la clôture — motif d'échec (« Client absent : … »),
 * lieu de dépose (« Chez un voisin : … »), « M — Message laissé », « Réserve : … » —
 * qui racontent un incident ou une remise, pas une consigne durable.
 */
export function consignesDepuisNotes(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const prefixes = [...MOTIFS_ECHEC.map((m) => `${m.label.toLowerCase()} :`), ...LIEUX_LIVRAISON.map((l) => `${l.label.toLowerCase()} :`), "réserve :", "m — message laissé"];
  const gardes = notes
    .split(" · ")
    .map((p) => p.trim())
    .filter((p) => p && !prefixes.some((x) => p.toLowerCase().startsWith(x)));
  return nettoyer(gardes.join(" · "), LONGUEURS.consignes);
}

// ── Fusion d'une observation ────────────────────────────────────

/** Une adresse n'entre dans l'annuaire client que si c'est un établissement (nom d'entreprise) ou si elle y figure déjà. */
export function retenirAdresse(arret: { business_name?: string | null; kind?: string | null }, ficheExistante: boolean): boolean {
  if (ficheExistante) return true;
  if (arret.kind === "point_relais") return true;
  return Boolean(nettoyer(arret.business_name, LONGUEURS.nom));
}

/**
 * Nouvelle valeur de la fiche après un arrêt clôturé. Renvoie TOUTES les
 * colonnes « client » (prêtes pour un upsert), calculées à partir de la fiche
 * existante : une valeur vide dans l'observation ne remplace jamais une valeur
 * connue.
 */
export function fusionnerObservation(existante: Record<string, unknown> | null | undefined, obs: ObservationArret): DonneesClient {
  const f = lireDonnees(existante);
  const heure = String(Math.min(23, Math.max(0, Math.floor(obs.heure))));
  const parHeure = { ...f.success_by_hour };
  const cree = parHeure[heure] ?? { ok: 0, ko: 0 };
  parHeure[heure] = obs.statut === "delivered" ? { ok: plus1(cree.ok), ko: cree.ko } : { ok: cree.ok, ko: plus1(cree.ko) };

  const motifs = { ...f.failure_reasons };
  if (obs.statut === "failed") {
    const motif = obs.motif && MOTIFS.has(obs.motif) ? obs.motif : "autre";
    motifs[motif] = plus1(motifs[motif] ?? 0);
  }

  const debut = lireHeure(obs.fenetre?.debut ?? null) !== null ? (obs.fenetre!.debut ?? null) : null;
  const fin = lireHeure(obs.fenetre?.fin ?? null) !== null ? (obs.fenetre!.fin ?? null) : null;
  const nouvelleFenetre = debut !== null || fin !== null;

  const duree = obs.statut === "delivered" && typeof obs.dureeMin === "number" && Number.isFinite(obs.dureeMin) && obs.dureeMin > 0 ? obs.dureeMin : null;

  return {
    label: derniereNonVide(f.label, obs.nom, LONGUEURS.nom),
    phone: derniereNonVide(f.phone, obs.telephone, LONGUEURS.telephone),
    recipient: derniereNonVide(f.recipient, obs.destinataire, LONGUEURS.destinataire),
    access_notes: derniereNonVide(f.access_notes, obs.consignes, LONGUEURS.consignes),
    lat: typeof obs.lat === "number" && Number.isFinite(obs.lat) ? obs.lat : f.lat,
    lng: typeof obs.lng === "number" && Number.isFinite(obs.lng) ? obs.lng : f.lng,
    window_start: nouvelleFenetre ? debut : f.window_start,
    window_end: nouvelleFenetre ? fin : f.window_end,
    service_avg_min: duree === null ? f.service_avg_min : moyenneGlissante(f.service_avg_min, f.service_samples, duree),
    service_samples: duree === null ? f.service_samples : plus1(f.service_samples),
    delivered_count: obs.statut === "delivered" ? plus1(f.delivered_count) : f.delivered_count,
    failed_count: obs.statut === "failed" ? plus1(f.failed_count) : f.failed_count,
    success_by_hour: parHeure,
    failure_reasons: motifs,
    contact_message_count: obs.contactMessage ? plus1(f.contact_message_count) : f.contact_message_count,
    contact_phone_count: obs.contactTelephone ? plus1(f.contact_phone_count) : f.contact_phone_count,
    last_delivery_at: obs.statut === "delivered" ? obs.quand : f.last_delivery_at,
  };
}

// ── Lecture des statistiques ────────────────────────────────────

export interface CreneauReussite {
  /** « 10:00 » */
  debut: string;
  /** « 11:00 » */
  fin: string;
  /** Part de livraisons réussies dans cette heure (0 à 1). */
  taux: number;
  passages: number;
}

const heureTexte = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** Heure où la livraison réussit le plus souvent (assez de passages, au moins 60 % de réussite). */
export function creneauReussite(f: { success_by_hour?: unknown } | null | undefined): CreneauReussite | null {
  const par = lireReussites(f?.success_by_hour);
  let meilleur: (CreneauReussite & { ok: number }) | null = null;
  for (const [h, r] of Object.entries(par)) {
    const passages = r.ok + r.ko;
    const taux = r.ok / passages;
    if (passages < CRENEAU_PASSAGES_MIN || taux < CRENEAU_TAUX_MIN) continue;
    const heure = Number(h);
    if (!meilleur || taux > meilleur.taux + 1e-9 || (Math.abs(taux - meilleur.taux) < 1e-9 && r.ok > meilleur.ok)) {
      meilleur = { debut: heureTexte(heure), fin: heureTexte(heure + 1), taux: Math.round(taux * 100) / 100, passages, ok: r.ok };
    }
  }
  if (!meilleur) return null;
  const { ok: _ok, ...creneau } = meilleur;
  return creneau;
}

export interface EchecFrequent {
  echecs: number;
  passages: number;
  /** Motif le plus fréquent (clé), null si inconnu. */
  motif: string | null;
  /** « Échec fréquent ici : 3 sur 5 (client absent) » */
  libelle: string;
}

/** Alerte « échec fréquent ici ». */
export function echecFrequent(f: { delivered_count?: number | null; failed_count?: number | null; failure_reasons?: unknown } | null | undefined): EchecFrequent | null {
  if (!f) return null;
  const echecs = entier(f.failed_count);
  const passages = entier(f.delivered_count) + echecs;
  if (echecs < ECHECS_FREQUENTS_MIN || passages === 0 || echecs / passages < ECHECS_FREQUENTS_TAUX) return null;
  const motifs = Object.entries(lireMotifs(f.failure_reasons)).sort((a, b) => b[1] - a[1]);
  const motif = motifs[0]?.[0] ?? null;
  const nom = libelleMotif(motif)?.toLowerCase();
  return { echecs, passages, motif, libelle: `Échec fréquent ici : ${echecs} sur ${passages}${nom ? ` (${nom})` : ""}` };
}

/** « ≈ 4 min d'arrêt » quand la durée est connue (assez de passages), sinon null. */
export function libelleDuree(f: { service_avg_min?: number | string | null; service_samples?: number | null } | null | undefined): string | null {
  const d = dureeServicePrevue(f, 0);
  return d > 0 ? `≈ ${Math.round(d)} min d'arrêt` : null;
}

// ── Suggestions ─────────────────────────────────────────────────

/** Ce que l'ajout d'un arrêt reprend de la fiche, sans jamais écraser une saisie. */
export interface PreremplissageArret {
  phone: string | null;
  recipient: string | null;
  notes: string | null;
  business_name: string | null;
  window_start: string | null;
  window_end: string | null;
}

/**
 * Préremplissage d'un nouvel arrêt à partir de la fiche : seuls les champs que
 * la saisie a laissés vides sont repris. Le créneau n'est repris que si
 * l'arrêt n'en a pas déjà un.
 */
export function prerempli(
  fiche: Record<string, unknown> | null | undefined,
  saisie: { phone?: string | null; recipient?: string | null; notes?: string | null; business_name?: string | null; window_start?: string | null; window_end?: string | null },
): PreremplissageArret {
  const f = lireDonnees(fiche);
  const vide = (v: string | null | undefined) => nettoyer(v, 1000) === null;
  const avecFenetre = lireHeure(saisie.window_start) !== null || lireHeure(saisie.window_end) !== null;
  const reprendreFenetre = !avecFenetre && (lireHeure(f.window_start) !== null || lireHeure(f.window_end) !== null);
  return {
    phone: vide(saisie.phone) ? f.phone : null,
    recipient: vide(saisie.recipient) ? f.recipient : null,
    notes: vide(saisie.notes) ? f.access_notes : null,
    business_name: vide(saisie.business_name) ? f.label : null,
    window_start: reprendreFenetre ? f.window_start : null,
    window_end: reprendreFenetre ? f.window_end : null,
  };
}

/** Résumé d'une fiche pour la suggestion d'adresse (annuaire en premier). */
export interface ResumeFiche {
  telephone: string | null;
  destinataire: string | null;
  consignes: string | null;
  duree: string | null;
  creneau: string | null;
  echec: string | null;
}

export function resumeFiche(fiche: Record<string, unknown> | null | undefined): ResumeFiche {
  const f = lireDonnees(fiche);
  const c = creneauReussite(f);
  return {
    telephone: f.phone,
    destinataire: f.recipient,
    consignes: f.access_notes,
    duree: libelleDuree(f),
    creneau: c ? `Livraison réussie surtout vers ${c.debut.replace(":00", " h")}–${c.fin.replace(":00", " h")}` : null,
    echec: echecFrequent(f)?.libelle ?? null,
  };
}

/** Ligne de détail d'une suggestion de l'annuaire : « Déjà livré · 05 56 12 34 56 · ≈ 4 min d'arrêt ». */
export function detailSuggestion(r: ResumeFiche): string {
  return ["Déjà livré par votre équipe", r.telephone, r.duree].filter(Boolean).join(" · ");
}

/**
 * Créneau conseillé pour la livraison : le créneau de réussite s'il existe.
 * Si l'adresse a des horaires d'ouverture, le conseil doit y tenir (`ouvert` :
 * l'heure conseillée tombe dans une fenêtre ; sinon il est écarté).
 */
export function creneauConseille(f: { success_by_hour?: unknown } | null | undefined, ouvert?: (minute: number) => boolean): CreneauReussite | null {
  const c = creneauReussite(f);
  if (!c) return null;
  const minute = lireHeure(c.debut);
  if (ouvert && minute !== null && !ouvert(minute)) return null;
  return c;
}
