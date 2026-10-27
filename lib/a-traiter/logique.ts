/**
 * « À traiter aujourd'hui » : une seule liste de tout ce qui attend
 * l'exploitation (et la direction), triée par urgence puis ancienneté.
 *
 * Fichier pur (aucune dépendance serveur) : partagé par le chargement
 * serveur (lib/a-traiter/serveur.ts), le composant (components/dashboard/
 * ATraiter.tsx) et les tests (lib/a-traiter/__tests__).
 *
 * Règle de hiérarchie (lib/hierarchie/demandes.ts, miroir de la base :
 * verifier_decision_hierarchie) : personne ne décide sa propre demande ;
 * la direction seule peut s'auto-valider, avec trace d'audit. Un élément
 * dont la personne connectée est l'auteur n'apparaît donc jamais comme
 * « à traiter par moi » : il est verrouillé, avec l'explication. Un
 * élément qu'elle ne peut pas décider pour une autre raison (rang égal ou
 * supérieur) n'est montré à personne qui ne peut pas le traiter.
 */

import { peutDecider, type PersonneHierarchie } from "@/lib/hierarchie/demandes";

export const TYPES_A_TRAITER = [
  "ecart_carburant",
  "amende",
  "entretien",
  "demande",
  "ticpe",
  "tournee_sans_chauffeur",
  "repartition_a_attribuer",
  "tournee_non_demarree",
  "tournee_en_retard",
  "ticket_ocr",
  "echeance_vehicule",
  "bulletin_paie",
  "conge",
  "arret",
  "pointage_a_regulariser",
  "repos_conduite",
  "echeance_rh",
  "contestation",
  "inscription",
] as const;
export type TypeATraiter = (typeof TYPES_A_TRAITER)[number];

export const LIBELLES_TYPE: Record<TypeATraiter, { singulier: string; pluriel: string }> = {
  ecart_carburant: { singulier: "Écart carburant", pluriel: "Écarts carburant" },
  amende: { singulier: "Amende", pluriel: "Amendes" },
  entretien: { singulier: "Entretien", pluriel: "Entretien" },
  demande: { singulier: "Demande", pluriel: "Demandes" },
  ticpe: { singulier: "TICPE", pluriel: "TICPE" },
  tournee_sans_chauffeur: { singulier: "Tournée sans chauffeur", pluriel: "Tournées sans chauffeur" },
  repartition_a_attribuer: { singulier: "Tournée fusionnée à répartir", pluriel: "Tournées fusionnées à répartir" },
  tournee_non_demarree: { singulier: "Tournée non démarrée", pluriel: "Tournées non démarrées" },
  tournee_en_retard: { singulier: "Tournée en retard", pluriel: "Tournées en retard" },
  ticket_ocr: { singulier: "Ticket à vérifier", pluriel: "Tickets à vérifier" },
  echeance_vehicule: { singulier: "Échéance véhicule", pluriel: "Échéances véhicules" },
  bulletin_paie: { singulier: "Bulletins à valider", pluriel: "Bulletins à valider" },
  conge: { singulier: "Congé", pluriel: "Congés" },
  arret: { singulier: "Arrêt de travail", pluriel: "Arrêts de travail" },
  pointage_a_regulariser: { singulier: "Pointage à régulariser", pluriel: "Pointages à régulariser" },
  repos_conduite: { singulier: "Repos ou durée du travail à vérifier", pluriel: "Repos ou durée du travail à vérifier" },
  echeance_rh: { singulier: "Échéance RH", pluriel: "Échéances RH" },
  contestation: { singulier: "Contestation client", pluriel: "Contestations clients" },
  inscription: { singulier: "Inscription", pluriel: "Inscriptions" },
};

/**
 * Écran(s) du catalogue qui traitent chaque type (celui de la source de
 * lib/a-traiter/serveur.ts). Sert à verrouiller la matrice des rôles par
 * test : un type n'est lu que si l'un de ces écrans s'ouvre pour le rôle.
 */
export const ECRANS_PAR_TYPE: Record<TypeATraiter, readonly string[]> = {
  ecart_carburant: ["carburant.pleins"],
  amende: ["flotte.amendes"],
  entretien: ["flotte.entretien"],
  demande: ["communication.intranet", "communication.assistance"],
  ticpe: ["carburant.ticpe_controles"],
  tournee_sans_chauffeur: ["exploitation.planning"],
  repartition_a_attribuer: ["exploitation.planning"],
  tournee_non_demarree: ["exploitation.planning"],
  tournee_en_retard: ["exploitation.suivi"],
  ticket_ocr: ["carburant.revue_ocr"],
  echeance_vehicule: ["flotte.vehicules", "flotte.amendes"],
  bulletin_paie: ["equipe.paie"],
  conge: ["equipe.conges"],
  arret: ["equipe.arrets"],
  pointage_a_regulariser: ["equipe.pointage"],
  repos_conduite: ["equipe.pointage"],
  echeance_rh: ["equipe.utilisateur_fiche"],
  contestation: ["exploitation.contestations"],
  inscription: ["equipe.inscriptions"],
};

export type Urgence = "haute" | "normale";

/**
 * Types qu'un manager (chef d'équipe) retrouve dans « À traiter » : ceux
 * dont la lecture est limitée à ses services par la RLS (carburant, congés,
 * planning), par le code (retards du suivi, et demandes d'entretien : la
 * lecture des interventions est ouverte à toute l'organisation en base, le
 * filtre par service du véhicule se fait dans lib/a-traiter/serveur.ts). Les
 * autres (amendes, contestations, demandes, TICPE, inscriptions, arrêts de
 * travail, paie…) restent à l'exploitation et à la direction. Exploitation
 * et direction : tous les types, sauf la paie qui reste à la direction.
 */
export const TYPES_MANAGER: readonly TypeATraiter[] = [
  "ecart_carburant",
  "ticket_ocr",
  "echeance_vehicule",
  "entretien",
  "conge",
  // Pointages, repos et échéances RH : lecture limitée à ses services par la RLS (pointage, alertes) ;
  // les échéances sensibles (visite médicale, contrat, titre de séjour) ne lui sont jamais adressées.
  "pointage_a_regulariser",
  "repos_conduite",
  "echeance_rh",
  "tournee_sans_chauffeur",
  "repartition_a_attribuer",
  "tournee_non_demarree",
  "tournee_en_retard",
];

/**
 * Rôles qui ont « À traiter » (écran dashboard.a_traiter du catalogue) :
 * jamais le chauffeur ni le comptable, qui n'ont pas de liste de décisions.
 */
export const ROLES_A_TRAITER: readonly string[] = ["manager", "exploitation", "direction"];

/**
 * Types réservés à la direction : la validation des bulletins de paie ne
 * revient ni au manager ni à l'exploitation (le catalogue ne leur ouvre pas
 * « Paie & salaires » : lib/roles/perimetre.ts, « jamais la paie »). Le
 * comptable prépare la paie mais n'a pas la liste « À traiter ».
 */
export const TYPES_DIRECTION: readonly TypeATraiter[] = ["bulletin_paie"];

/** L'élément de ce type peut-il figurer dans la liste de ce rôle ? Garde de défense, en plus de l'écran du catalogue. */
export function typeVisiblePour(type: TypeATraiter, role: string): boolean {
  if (role === "direction") return true;
  if (role === "exploitation") return !TYPES_DIRECTION.includes(type);
  if (role === "manager") return TYPES_MANAGER.includes(type);
  return false;
}

/** Types visibles de ce rôle, dans l'ordre du catalogue. */
export function typesVisiblesPour(role: string): TypeATraiter[] {
  return TYPES_A_TRAITER.filter((t) => typeVisiblePour(t, role));
}

/** Plafond de lignes lues par source (une requête, jamais de pagination). */
export const PLAFOND_PAR_SOURCE = 200;

// ── Urgence ─────────────────────────────────────────────────────────

export interface EntreeUrgence {
  /** Date de la demande (ISO) : l'ancienneté joue. */
  depuis?: string | null;
  /** Échéance (ISO ou AAAA-MM-JJ) : proche ou dépassée, elle joue. */
  echeance?: string | null;
  /** Urgence déclarée par la source (entretien critique, tournée très en retard…). */
  critique?: boolean;
}

/**
 * Seuils par type, en heures. Haute urgence si la source la déclare, si
 * la demande attend depuis `ancienneteHeures` ou plus, ou si l'échéance
 * tombe dans `echeanceHeures` (une échéance dépassée compte).
 */
export const SEUILS_URGENCE: Record<TypeATraiter, { ancienneteHeures: number | null; echeanceHeures: number | null }> = {
  ecart_carburant: { ancienneteHeures: 48, echeanceHeures: null },
  amende: { ancienneteHeures: 168, echeanceHeures: 168 },
  entretien: { ancienneteHeures: 120, echeanceHeures: null },
  demande: { ancienneteHeures: 72, echeanceHeures: 72 },
  ticpe: { ancienneteHeures: null, echeanceHeures: 240 },
  tournee_sans_chauffeur: { ancienneteHeures: null, echeanceHeures: 3 },
  // Tournée fusionnée du jour dont des villages ou ramasses restent « À attribuer » : urgent à l'approche du départ.
  repartition_a_attribuer: { ancienneteHeures: null, echeanceHeures: 3 },
  tournee_non_demarree: { ancienneteHeures: null, echeanceHeures: null },
  // Tournée en cours : l'urgence est déclarée par la source (retard de 30 min ou plus).
  tournee_en_retard: { ancienneteHeures: null, echeanceHeures: null },
  // Ticket de carburant à relire (OCR) : une journée d'attente suffit à le dire urgent.
  ticket_ocr: { ancienneteHeures: 48, echeanceHeures: null },
  // Contrôle technique, assurance, licence, amende à payer au tarif minoré : urgent à 7 jours de l'échéance ou une fois dépassée.
  echeance_vehicule: { ancienneteHeures: null, echeanceHeures: 168 },
  // Bulletins du mois : l'urgence est déclarée par la source (mois passé).
  bulletin_paie: { ancienneteHeures: null, echeanceHeures: null },
  conge: { ancienneteHeures: 120, echeanceHeures: 72 },
  arret: { ancienneteHeures: 48, echeanceHeures: null },
  // Sortie oubliée : le paiement des heures en dépend, urgent après deux jours.
  pointage_a_regulariser: { ancienneteHeures: 48, echeanceHeures: null },
  // Avertissement de repos : informatif, l'urgence est déclarée par la source (aucune).
  repos_conduite: { ancienneteHeures: null, echeanceHeures: null },
  // Permis, visite médicale, contrat, documents : urgent à 7 jours de l'échéance ou une fois dépassée.
  echeance_rh: { ancienneteHeures: null, echeanceHeures: 168 },
  contestation: { ancienneteHeures: 120, echeanceHeures: null },
  inscription: { ancienneteHeures: 72, echeanceHeures: null },
};

const HEURE = 3600000;

function instant(v: string | null | undefined): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

export function calculerUrgence(type: TypeATraiter, e: EntreeUrgence, maintenant: Date): Urgence {
  if (e.critique) return "haute";
  const seuils = SEUILS_URGENCE[type];
  const now = maintenant.getTime();
  const depuis = instant(e.depuis);
  if (seuils.ancienneteHeures !== null && depuis !== null && now - depuis >= seuils.ancienneteHeures * HEURE) return "haute";
  const echeance = instant(e.echeance);
  if (seuils.echeanceHeures !== null && echeance !== null && echeance - now <= seuils.echeanceHeures * HEURE) return "haute";
  return "normale";
}

// ── Éléments ────────────────────────────────────────────────────────

/** Ligne telle que lue par une source, avant la règle d'auteur. */
export interface ElementBrut {
  type: TypeATraiter;
  id: string;
  /** « {nom} » est remplacé par le nom de `personneId` (sinon « un salarié »). */
  libelle: string;
  detail?: string | null;
  depuis?: string | null;
  echeance?: string | null;
  critique?: boolean;
  /** Écran du catalogue qui traite l'élément, et son adresse complète. */
  ecran: string;
  href: string;
  /** Personne dont la demande est décidée (la hiérarchie s'applique). Null : aucune. */
  auteurId?: string | null;
  /** Personne nommée dans le libellé. */
  personneId?: string | null;
  /** L'écran de traitement permet de choisir librement la personne (amende, contestation à valider) : jamais masqué. */
  choixLibre?: boolean;
  /** Une action groupée existe pour ce type d'élément. */
  groupable?: boolean;
  /** Décision de paie que le comptable garde (sans effet pour l'exploitation et la direction). */
  paie?: boolean;
  /** Litrage et véhicule d'un écart carburant (récapitulatif avant validation en lot). */
  litres?: number | null;
  vehicule?: string | null;
}

/** Ligne affichée (sans identifiant de personne : rien de superflu côté navigateur). */
export interface ElementATraiter {
  cle: string;
  type: TypeATraiter;
  id: string;
  libelle: string;
  detail: string | null;
  depuis: string | null;
  echeance: string | null;
  urgence: Urgence;
  ecran: string;
  href: string;
  /** Sélectionnable pour une action groupée. */
  groupable: boolean;
  /** Explication quand la personne connectée ne peut pas traiter l'élément. */
  verrou: string | null;
  /** Direction seule qui décide pour elle-même : tracé « auto-validée ». */
  autoValidation: boolean;
  litres: number | null;
  vehicule: string | null;
}

export const cleElement = (type: TypeATraiter, id: string) => `${type}:${id}`;

export type EtatAuteur = "libre" | "autorise" | "auto" | "verrouille" | "masque";

/**
 * La personne connectée peut-elle décider cet élément ? Même règle que
 * les routes individuelles (garderDecision → peutDecider) :
 *  - libre : aucun auteur ;
 *  - autorise : rang supérieur à celui de l'auteur ;
 *  - auto : direction seule, qui décide pour elle-même (tracé) ;
 *  - verrouille : sa propre demande, à traiter par un autre ;
 *  - masque : un auteur de rang égal ou supérieur, qu'elle ne peut pas traiter.
 */
export function evaluerAuteur(p: { moi: PersonneHierarchie; auteur: PersonneHierarchie | null; directionCount: number; paie?: boolean }): { etat: EtatAuteur; raison: string | null } {
  if (!p.auteur) return { etat: "libre", raison: null };
  const v = peutDecider({ decideur: p.moi, demandeur: p.auteur, directionCount: p.directionCount, paie: p.paie });
  if (v.ok) return { etat: v.autoValidee ? "auto" : "autorise", raison: null };
  return { etat: p.auteur.id === p.moi.id ? "verrouille" : "masque", raison: v.raison };
}

export interface PersonneConnue {
  role: string;
  nom: string | null;
}

export interface ResultatListe {
  /** À traiter par la personne connectée, triés. */
  elements: ElementATraiter[];
  /** Ses propres demandes en attente d'un autre décideur (non comptées). */
  verrouilles: ElementATraiter[];
}

function remplacerNom(texte: string | null | undefined, nom: string | null): string | null {
  if (texte === null || texte === undefined) return null;
  return texte.replaceAll("{nom}", nom ?? "un salarié");
}

/**
 * Applique la règle d'auteur à chaque ligne brute, calcule l'urgence et
 * trie. `personnes` : rôle et nom des personnes citées (une seule lecture).
 */
export function construireListe(p: {
  brutes: readonly ElementBrut[];
  moi: PersonneHierarchie;
  personnes: ReadonlyMap<string, PersonneConnue>;
  directionCount: number;
  maintenant: Date;
}): ResultatListe {
  const elements: ElementATraiter[] = [];
  const verrouilles: ElementATraiter[] = [];
  for (const b of p.brutes) {
    const auteur: PersonneHierarchie | null = b.auteurId
      ? { id: b.auteurId, role: p.personnes.get(b.auteurId)?.role ?? (b.auteurId === p.moi.id ? p.moi.role : "chauffeur") }
      : null;
    const { etat, raison } = evaluerAuteur({ moi: p.moi, auteur, directionCount: p.directionCount, paie: b.paie });
    // Un élément qu'on ne peut pas décider n'est montré que si la personne y trouve autre chose à faire (choix libre).
    if (etat === "masque" && !b.choixLibre) continue;
    const nom = b.personneId ? (p.personnes.get(b.personneId)?.nom ?? null) : null;
    const bloque = etat === "verrouille" || etat === "masque";
    const el: ElementATraiter = {
      cle: cleElement(b.type, b.id),
      type: b.type,
      id: b.id,
      libelle: remplacerNom(b.libelle, nom) ?? "",
      detail: remplacerNom(b.detail, nom),
      depuis: b.depuis ?? null,
      echeance: b.echeance ?? null,
      urgence: calculerUrgence(b.type, b, p.maintenant),
      ecran: b.ecran,
      href: b.href,
      groupable: Boolean(b.groupable) && !bloque,
      verrou: etat === "verrouille" ? raison : null,
      autoValidation: etat === "auto",
      litres: b.litres ?? null,
      vehicule: b.vehicule ?? null,
    };
    // Choix libre : l'élément reste à traiter, mais pas en lot tant que le responsable proposé est inadmissible.
    if (etat === "verrouille" && b.choixLibre) {
      elements.push({ ...el, verrou: null });
    } else if (etat === "verrouille") {
      verrouilles.push(el);
    } else {
      elements.push(el);
    }
  }
  return { elements: trier(elements), verrouilles: trier(verrouilles) };
}

// ── Tri, comptage, filtres ──────────────────────────────────────────

const RANG_URGENCE: Record<Urgence, number> = { haute: 0, normale: 1 };

/** Clé d'ancienneté : la date de la demande, à défaut l'échéance. Plus petit = plus ancien. */
function cleAnciennete(e: Pick<ElementATraiter, "depuis" | "echeance">): number {
  return instant(e.depuis) ?? instant(e.echeance) ?? Number.POSITIVE_INFINITY;
}

/** Urgence haute d'abord, puis le plus ancien ; à égalité, ordre stable (type puis identifiant). */
export function trier<T extends Pick<ElementATraiter, "urgence" | "depuis" | "echeance" | "cle">>(elements: readonly T[]): T[] {
  return [...elements].sort((a, b) => {
    const u = RANG_URGENCE[a.urgence] - RANG_URGENCE[b.urgence];
    if (u !== 0) return u;
    const ka = cleAnciennete(a);
    const kb = cleAnciennete(b);
    if (ka !== kb) return ka < kb ? -1 : 1;
    return a.cle < b.cle ? -1 : a.cle > b.cle ? 1 : 0;
  });
}

export interface Compteurs {
  total: number;
  hautes: number;
  parType: Record<TypeATraiter, number>;
}

export function compter(elements: readonly Pick<ElementATraiter, "type" | "urgence">[]): Compteurs {
  const parType = Object.fromEntries(TYPES_A_TRAITER.map((t) => [t, 0])) as Record<TypeATraiter, number>;
  let hautes = 0;
  for (const e of elements) {
    parType[e.type]++;
    if (e.urgence === "haute") hautes++;
  }
  return { total: elements.length, hautes, parType };
}

/** Filtre par type ; aucun type retenu = tout. */
export function filtrerParTypes<T extends Pick<ElementATraiter, "type">>(elements: readonly T[], types: ReadonlySet<TypeATraiter> | readonly TypeATraiter[] | null): T[] {
  const set = types ? new Set(types) : null;
  if (!set || set.size === 0) return [...elements];
  return elements.filter((e) => set.has(e.type));
}

/** Types connus, dans l'ordre du catalogue, à partir d'une chaîne « conge,arret » (adresse de la page). */
export function typesDepuisTexte(texte: string | null | undefined): TypeATraiter[] {
  const voulus = new Set((texte ?? "").split(",").map((s) => s.trim()));
  return TYPES_A_TRAITER.filter((t) => voulus.has(t));
}

// ── Libellés de durée ───────────────────────────────────────────────

/** « il y a 3 j », « il y a 2 h », « à l'instant » (futur : « dans … »). */
export function libelleDuree(iso: string | null | undefined, maintenant: Date): string | null {
  const t = instant(iso);
  if (t === null) return null;
  const ecart = maintenant.getTime() - t;
  const passe = ecart >= 0;
  const abs = Math.abs(ecart);
  if (abs < 5 * 60000) return passe ? "à l'instant" : "dans un instant";
  let texte: string;
  if (abs < HEURE) texte = `${Math.round(abs / 60000)} min`;
  else if (abs < 24 * HEURE) texte = `${Math.floor(abs / HEURE)} h`;
  else texte = `${Math.floor(abs / (24 * HEURE))} j`;
  return passe ? `il y a ${texte}` : `dans ${texte}`;
}

/** Nombre affiché, borné par le plafond (« 200+ » quand la source a été tronquée). */
export function libelleNombre(n: number, plafonne: boolean): string {
  return plafonne ? `${n}+` : String(n);
}
