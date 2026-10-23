/**
 * Départ et arrivée de la tournée choisis par le chauffeur dans
 * « Optimiser l'ordre » : où il part (dépôt, sa position, un arrêt, une
 * autre adresse) et où il finit (retour au dépôt, même point, un arrêt,
 * une autre adresse, ou rien d'imposé). Un arrêt choisi comme départ
 * devient le 1er, comme arrivée le dernier (épingle 📌).
 *
 * Logique pure, testée dans lib/colis/__tests__/extremites.test.ts. Le
 * choix est mémorisé sur la tournée (delivery_runs.optim_depart /
 * optim_arrivee, migration 20261102000001) ou, à défaut, sur l'appareil.
 */
import { z } from "zod";
import { grouperParListe, nomGroupe, type Liste } from "@/lib/colis/listes";
import { memePoint, type Point } from "@/lib/colis/optimisation";

export type Depart =
  | { mode: "depot" }
  | { mode: "position" }
  | { mode: "arret"; arret_id: string }
  | { mode: "adresse"; label: string; lat: number; lng: number };

export type Arrivee =
  | { mode: "depot" }
  | { mode: "meme" }
  | { mode: "arret"; arret_id: string }
  | { mode: "adresse"; label: string; lat: number; lng: number }
  | { mode: "libre" };

const adresse = { label: z.string().trim().min(1).max(200), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) };

export const schemaDepart = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("depot") }),
  z.object({ mode: z.literal("position") }),
  z.object({ mode: z.literal("arret"), arret_id: z.string().uuid() }),
  z.object({ mode: z.literal("adresse"), ...adresse }),
]);

export const schemaArrivee = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("depot") }),
  z.object({ mode: z.literal("meme") }),
  z.object({ mode: z.literal("arret"), arret_id: z.string().uuid() }),
  z.object({ mode: z.literal("adresse"), ...adresse }),
  z.object({ mode: z.literal("libre") }),
]);

/** Lit une valeur stockée (jsonb, mémoire locale) ; null si absente ou invalide. */
export function lireDepart(v: unknown): Depart | null {
  const r = schemaDepart.safeParse(v);
  return r.success ? r.data : null;
}
export function lireArrivee(v: unknown): Arrivee | null {
  const r = schemaArrivee.safeParse(v);
  return r.success ? r.data : null;
}

/** Arrêt tel que l'optimisation le voit. */
export interface ArretExtremite {
  id: string;
  status: string;
  lat: number | string | null;
  lng: number | string | null;
  address: string;
  list_id?: string | null;
  position?: number;
}

export interface EntreeExtremites {
  /** Choix mémorisé ; null : jamais choisi (comportement historique). */
  depart: Depart | null;
  arrivee: Arrivee | null;
  /** Dépôt (service du chauffeur, sinon organisation) ; null : inconnu. */
  depot: Point | null;
  depotLibelle?: string | null;
  /** Position actuelle du chauffeur, quand la requête la fournit (réoptimisation en cours de route). */
  position: Point | null;
  arrets: ArretExtremite[];
  /** Retour au dépôt demandé par la tournée (delivery_runs.return_to_start). */
  retourParDefaut: boolean;
}

export interface ExtremitesResolues {
  /** Point de départ du chemin (null : l'ordre part du premier arrêt). */
  depart: Point | null;
  departLibelle: string;
  /** Arrêt servi en premier. */
  premierId: string | null;
  /** Point final après le dernier arrêt ; null : pas de retour imposé. */
  fin: Point | null;
  arriveeLibelle: string;
  /** Arrêt servi en dernier. */
  dernierId: string | null;
  erreur?: string;
}

const pointDe = (a: { lat: number | string | null; lng: number | string | null }): Point | null => (a.lat === null || a.lng === null ? null : { lat: Number(a.lat), lng: Number(a.lng) });

const abreger = (t: string, max = 48) => (t.length > max ? `${t.slice(0, max - 1)}…` : t);

/** Départ et arrivée effectifs d'une optimisation, ou une erreur claire (arrêt traité, sans GPS, dépôt inconnu…). */
export function resoudreExtremites(e: EntreeExtremites): ExtremitesResolues {
  const vide: ExtremitesResolues = { depart: null, departLibelle: "Premier arrêt", premierId: null, fin: null, arriveeLibelle: "Pas de retour imposé", dernierId: null };
  const refus = (erreur: string): ExtremitesResolues => ({ ...vide, erreur });
  const restants = e.arrets.filter((a) => a.status === "pending");
  const arret = (id: string, role: string): { a: ArretExtremite; p: Point } | string => {
    const a = e.arrets.find((x) => x.id === id);
    if (!a) return `L'arrêt choisi comme ${role} n'existe plus dans la tournée.`;
    if (a.status !== "pending") return `L'arrêt « ${abreger(a.address)} » est déjà traité : il ne peut pas être ${role === "départ" ? "le premier" : "le dernier"}.`;
    const p = pointDe(a);
    if (!p) return `L'arrêt « ${abreger(a.address)} » n'a pas de position GPS : corrigez son adresse avant de le choisir comme ${role}.`;
    return { a, p };
  };
  const libelleDepot = e.depotLibelle?.trim() || "Dépôt";

  // ── Départ ──
  let depart: Point | null = null;
  let departLibelle = "Premier arrêt";
  let premierId: string | null = null;
  const d = e.depart;
  if (!d) {
    // Comportement historique : position du chauffeur si fournie, sinon dépôt.
    if (e.position) [depart, departLibelle] = [e.position, "Ma position actuelle"];
    else if (e.depot) [depart, departLibelle] = [e.depot, libelleDepot];
  } else if (d.mode === "arret") {
    const r = arret(d.arret_id, "départ");
    if (typeof r === "string") return refus(r);
    premierId = r.a.id;
    // En cours de route (position fournie), le chauffeur part d'où il est : l'arrêt reste le premier à servir.
    if (e.position) [depart, departLibelle] = [e.position, "Ma position actuelle"];
    else [depart, departLibelle] = [r.p, abreger(r.a.address)];
  } else if (e.position) {
    // Réoptimisation en cours de route : on part de la position du chauffeur, quel que soit le choix mémorisé.
    [depart, departLibelle] = [e.position, "Ma position actuelle"];
  } else if (d.mode === "position") {
    return refus("Votre position actuelle n'est pas disponible : autorisez la localisation ou choisissez un autre départ.");
  } else if (d.mode === "depot") {
    if (!e.depot) return refus("Aucune adresse de dépôt n'est connue : choisissez une autre adresse de départ.");
    [depart, departLibelle] = [e.depot, libelleDepot];
  } else {
    [depart, departLibelle] = [{ lat: d.lat, lng: d.lng }, abreger(d.label)];
  }

  // ── Arrivée ──
  let fin: Point | null = null;
  let arriveeLibelle = "Pas de retour imposé";
  let dernierId: string | null = null;
  const a = e.arrivee;
  if (!a) {
    // Historique : retour au point de départ (le dépôt), sauf en cours de route.
    if (e.retourParDefaut && !e.position && depart) [fin, arriveeLibelle] = [depart, departLibelle];
  } else if (a.mode === "depot") {
    if (!e.depot) return refus("Aucune adresse de dépôt n'est connue : choisissez une autre adresse d'arrivée.");
    [fin, arriveeLibelle] = [e.depot, libelleDepot];
  } else if (a.mode === "meme") {
    if (depart) [fin, arriveeLibelle] = [depart, departLibelle];
  } else if (a.mode === "arret") {
    const r = arret(a.arret_id, "arrivée");
    if (typeof r === "string") return refus(r);
    dernierId = r.a.id;
    [fin, arriveeLibelle] = [r.p, abreger(r.a.address)];
  } else if (a.mode === "adresse") {
    [fin, arriveeLibelle] = [{ lat: a.lat, lng: a.lng }, abreger(a.label)];
  }

  if (premierId && dernierId && premierId === dernierId && restants.length > 1) {
    const s = e.arrets.find((x) => x.id === premierId);
    return refus(`L'arrêt « ${abreger(s?.address ?? "")} » ne peut pas être à la fois le premier et le dernier : choisissez deux arrêts différents.`);
  }
  return { depart, departLibelle, premierId, fin, arriveeLibelle, dernierId };
}

export interface ContrainteListes {
  /** Liste qui doit passer en premier (celle du premier arrêt) ; null : aucune contrainte. */
  premiereListe: string | null;
  /** Liste qui doit passer en dernier (celle du dernier arrêt). */
  derniereListe: string | null;
  erreur?: string;
}

/**
 * Une tournée à plusieurs listes enchaîne les listes l'une après l'autre
 * (la liste principale, sans nom, toujours en tête). Pour qu'un arrêt soit
 * le premier / le dernier de toute la tournée, sa liste doit être la
 * première / la dernière à passer. Si c'est impossible, renvoie une erreur
 * en français simple plutôt que de déplacer des arrêts d'une liste à l'autre.
 */
export function contraintesListes(arrets: ArretExtremite[], listes: Liste[], premierId: string | null, dernierId: string | null): ContrainteListes {
  const aucune: ContrainteListes = { premiereListe: null, derniereListe: null };
  if (!premierId && !dernierId) return aucune;
  const restants = arrets.filter((a) => a.status === "pending" && pointDe(a));
  const groupes = grouperParListe(restants as (ArretExtremite & { list_id?: string | null; position: number })[], listes).filter((g) => g.arrets.length);
  if (groupes.length <= 1) return aucune;
  const groupeDe = (id: string) => groupes.findIndex((g) => g.arrets.some((a) => a.id === id));
  const nom = (i: number) => `« ${nomGroupe(groupes[i]!)} »`;
  const adr = (id: string) => `« ${abreger(arrets.find((a) => a.id === id)?.address ?? "")} »`;
  const iP = premierId ? groupeDe(premierId) : -1;
  const iD = dernierId ? groupeDe(dernierId) : -1;
  if (premierId && dernierId && iP >= 0 && iP === iD) {
    return { ...aucune, erreur: `Le premier (${adr(premierId)}) et le dernier arrêt (${adr(dernierId)}) sont dans la même liste ${nom(iP)}, mais la tournée a d'autres listes entre les deux : mettez-les dans deux listes différentes, ou retirez l'un des deux choix.` };
  }
  // La liste principale (arrêts sans liste) est toujours en tête : elle ne peut pas passer en dernier ni derrière une autre.
  const principale = groupes.findIndex((g) => g.liste === null);
  if (premierId && iP >= 0 && principale >= 0 && iP !== principale) {
    return { ...aucune, erreur: `Pour mettre ${adr(premierId)} en premier, sa liste ${nom(iP)} devrait passer avant la liste principale, ce qui n'est pas possible : choisissez un arrêt de la liste principale, ou rangez les arrêts de la liste principale dans une liste nommée.` };
  }
  if (dernierId && iD >= 0 && principale >= 0 && iD === principale) {
    return { ...aucune, erreur: `Pour mettre ${adr(dernierId)} en dernier, sa liste ${nom(iD)} devrait passer après les autres, mais la liste principale est toujours en tête : choisissez un arrêt d'une autre liste, ou nommez la liste principale.` };
  }
  return {
    premiereListe: premierId && iP >= 0 ? (groupes[iP]!.liste?.id ?? null) : null,
    derniereListe: dernierId && iD >= 0 ? (groupes[iD]!.liste?.id ?? null) : null,
  };
}

/** Épingle d'un arrêt : 📌 premier, 📌 dernier ou aucune. */
export function epingleDe(depart: Depart | null, arrivee: Arrivee | null, id: string): "premier" | "dernier" | null {
  if (depart?.mode === "arret" && depart.arret_id === id) return "premier";
  if (arrivee?.mode === "arret" && arrivee.arret_id === id) return "dernier";
  return null;
}

/**
 * Nouveau choix après « Mettre en premier / en dernier » ou retrait de
 * l'épingle. Un seul premier et un seul dernier : épingler remplace
 * l'ancien ; épingler en premier un arrêt déjà dernier le retire de la fin
 * (retour au dépôt par défaut quand un dépôt est connu).
 */
export function epingler(
  depart: Depart | null,
  arrivee: Arrivee | null,
  id: string,
  role: "premier" | "dernier" | null,
  depotConnu: boolean,
): { depart: Depart | null; arrivee: Arrivee | null } {
  let d = depart;
  let a = arrivee;
  const parDefautDepart: Depart | null = depotConnu ? { mode: "depot" } : null;
  const parDefautArrivee: Arrivee | null = depotConnu ? { mode: "depot" } : { mode: "libre" };
  if (d?.mode === "arret" && d.arret_id === id) d = parDefautDepart;
  if (a?.mode === "arret" && a.arret_id === id) a = parDefautArrivee;
  if (role === "premier") d = { mode: "arret", arret_id: id };
  if (role === "dernier") a = { mode: "arret", arret_id: id };
  return { depart: d, arrivee: a };
}

/**
 * Point où la tournée finit après le dernier arrêt, pour l'heure de fin
 * estimée (lib/colis/estimation) : même résolution que l'optimisation,
 * mais sans arrêt introuvable ni erreur (un choix invalide donne « pas de
 * retour »). `retourParDefaut` s'applique tant que rien n'a été choisi.
 */
export function pointFinTournee(
  arrivee: Arrivee | null,
  depart: Depart | null,
  depot: Point | null,
  arrets: ArretExtremite[],
  retourParDefaut: boolean,
): Point | null {
  if (!arrivee) return retourParDefaut ? depot : null;
  switch (arrivee.mode) {
    case "depot":
      return depot;
    case "meme": {
      if (!depart || depart.mode === "depot") return depot;
      if (depart.mode === "adresse") return { lat: depart.lat, lng: depart.lng };
      if (depart.mode === "arret") {
        const s = arrets.find((x) => x.id === depart.arret_id);
        return s ? pointDe(s) : null;
      }
      return null;
    }
    case "adresse":
      return { lat: arrivee.lat, lng: arrivee.lng };
    case "arret": {
      const s = arrets.find((x) => x.id === arrivee.arret_id);
      return s ? pointDe(s) : null;
    }
    default:
      return null;
  }
}

/** Les deux points sont-ils le même endroit ? (réexporté pour les écrans) */
export { memePoint };
