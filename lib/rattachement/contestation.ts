/**
 * Rapprochement contestation client ↔ arrêt de tournée colis, et lecture
 * des preuves de livraison (logique pure, testée dans
 * lib/rattachement/__tests__/contestation.test.ts).
 *
 * Signaux, du plus fiable au moins fiable :
 *  - n° de colis identique (normalisé) → exact ;
 *  - n° de colis partiel (≥ 6 caractères), ou adresse / destinataire
 *    concordants le jour de la livraison → probable.
 * Plusieurs arrêts au meilleur niveau chez des chauffeurs différents :
 * pas de suggestion, l'encadrement choisit.
 */
import { libelleLieu } from "@/lib/colis/livraison";
import { distanceMetres, pointLePlusProche } from "@/lib/rattachement/format";
import type { Confiance } from "@/lib/rattachement/amende";

export interface ArretCandidat {
  id: string;
  parcelCode: string | null;
  address: string;
  recipient: string | null;
  status: string;
  doneAt: string | null;
  deliveredPlace: string | null;
  proofPhotoPaths: string[];
  proofCode: string | null;
  relayName: string | null;
  lat: number | null;
  lng: number | null;
  run: { id: string; driverId: string; driverName: string; runDate: string; planningEntryId: string | null; tourNumber: string | null };
}

export interface CriteresContestation {
  parcelCode: string | null;
  deliveryAddress: string | null;
  recipient: string | null;
  deliveryDate: string | null;
  tourNumber: string | null;
}

export interface ResultatContestation {
  confiance: Confiance;
  arret: ArretCandidat | null;
  candidats: { arret: ArretCandidat; confiance: Exclude<Confiance, "aucun">; raison: string }[];
  raison: string;
}

export const normaliser = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const normaliserCodeColis = (s: string | null | undefined) => (s ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

/** Adresses concordantes : égales, l'une contenue dans l'autre, ou ≥ 80 % des mots (hors mots vides). */
export function adressesConcordent(a: string | null, b: string | null): boolean {
  const x = normaliser(a);
  const y = normaliser(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const vides = new Set(["rue", "de", "du", "des", "la", "le", "les", "l", "d", "avenue", "av", "bd", "boulevard", "chemin", "allee", "place", "impasse", "route", "france"]);
  const mots = (s: string) => new Set(s.split(" ").filter((m) => m.length > 1 && !vides.has(m)));
  const mx = mots(x);
  const my = mots(y);
  if (mx.size === 0 || my.size === 0) return false;
  const communs = [...mx].filter((m) => my.has(m)).length;
  return communs / Math.min(mx.size, my.size) >= 0.8;
}

export function nomsConcordent(a: string | null, b: string | null): boolean {
  const x = normaliser(a);
  const y = normaliser(b);
  if (x.length < 3 || y.length < 3) return false;
  return x === y || x.includes(y) || y.includes(x);
}

const jourArret = (a: ArretCandidat) => a.run.runDate;

export function rapprocherContestation(c: CriteresContestation, arrets: readonly ArretCandidat[]): ResultatContestation {
  const code = normaliserCodeColis(c.parcelCode);
  const notes: ResultatContestation["candidats"] = [];

  for (const a of arrets) {
    const codeArret = normaliserCodeColis(a.parcelCode);
    const memeJour = c.deliveryDate ? jourArret(a) === c.deliveryDate : false;
    if (code && codeArret && codeArret === code) {
      // Code identique : exact, sauf si la date donnée contredit la tournée.
      if (c.deliveryDate && !memeJour) notes.push({ arret: a, confiance: "probable", raison: `colis ${c.parcelCode} trouvé dans une tournée d'un autre jour` });
      else notes.push({ arret: a, confiance: "exact", raison: `colis ${c.parcelCode} scanné dans la tournée` });
      continue;
    }
    if (code.length >= 6 && codeArret && (codeArret.includes(code) || code.includes(codeArret)) && Math.min(code.length, codeArret.length) >= 6) {
      notes.push({ arret: a, confiance: "probable", raison: `n° de colis proche (${a.parcelCode})` });
      continue;
    }
    if (memeJour) {
      const adresse = adressesConcordent(c.deliveryAddress, a.address);
      const nom = nomsConcordent(c.recipient, a.recipient);
      if (adresse && nom) notes.push({ arret: a, confiance: "probable", raison: "adresse et destinataire livrés ce jour-là" });
      else if (adresse) notes.push({ arret: a, confiance: "probable", raison: "adresse livrée ce jour-là" });
      else if (nom) notes.push({ arret: a, confiance: "probable", raison: "destinataire livré ce jour-là" });
    }
  }

  if (notes.length === 0) return { confiance: "aucun", arret: null, candidats: [], raison: "Aucun arrêt de tournée colis ne correspond." };

  // Tri : exact d'abord, puis arrêt livré, puis clôture la plus récente.
  const score = (n: (typeof notes)[number]) => (n.confiance === "exact" ? 2 : 1) * 10 + (n.arret.status === "delivered" ? 1 : 0);
  notes.sort((x, y) => score(y) - score(x) || (y.arret.doneAt ?? "").localeCompare(x.arret.doneAt ?? ""));
  const meilleur = notes[0]!;
  const memeNiveau = notes.filter((n) => n.confiance === meilleur.confiance);
  const chauffeurs = new Set(memeNiveau.map((n) => n.arret.run.driverId));
  if (chauffeurs.size > 1) {
    return { confiance: meilleur.confiance, arret: null, candidats: notes, raison: "Plusieurs livraisons possibles chez des chauffeurs différents : choisissez." };
  }
  return { confiance: meilleur.confiance, arret: meilleur.arret, candidats: notes, raison: meilleur.raison };
}

export interface EvenementArret {
  type: string;
  at: string;
  details: string | null;
}

export interface PreuveLivraison {
  stopId: string;
  photos: number;
  lieu: string | null;
  lieuCode: string | null;
  lieuConforme: boolean;
  code: string | null;
  relais: string | null;
  clotureA: string | null;
  statut: string;
  gps: { at: string; lat: number; lng: number; distanceM: number | null } | null;
  historique: { type: string; libelle: string; at: string; details: string | null }[];
  complete: boolean;
  verdict: string;
}

const LIEUX_CONFORMES = new Set(["main_propre", "qr_code", "boite_aux_lettres", "jardin", "point_relais"]);

const LIBELLE_EVENEMENT: Record<string, string> = {
  stop_created: "Arrêt créé",
  status_changed: "Statut modifié",
  delivered: "Livré",
  failed: "Échec de livraison",
  reopened: "Arrêt rouvert",
  reordered: "Ordre modifié",
  list_changed: "Liste modifiée",
  pickup_count_recorded: "Ramasse enregistrée",
  sms_prepared: "SMS préparé",
  sms_confirmed_sent: "SMS envoyé",
  call_started: "Appel lancé",
  call_confirmed: "Appel confirmé",
  note: "Note",
};

/**
 * Preuves de livraison d'un arrêt. « Complète » : livré, lieu conforme
 * (main propre, QR code, boîte aux lettres, jardin, point relais nommé)
 * et preuve matérielle (photo ou code scanné).
 */
export function evaluerPreuve(a: ArretCandidat, evenements: readonly EvenementArret[], points: readonly { at: string; lat: number; lng: number }[] = []): PreuveLivraison {
  const photos = a.proofPhotoPaths.filter(Boolean).length;
  const livre = a.status === "delivered";
  const lieuConforme = livre && Boolean(a.deliveredPlace && LIEUX_CONFORMES.has(a.deliveredPlace)) && (a.deliveredPlace !== "point_relais" || Boolean(a.relayName));
  const materielle = photos > 0 || Boolean(a.proofCode);
  const complete = livre && lieuConforme && materielle;

  let gps: PreuveLivraison["gps"] = null;
  if (a.doneAt) {
    const p = pointLePlusProche(points, a.doneAt, 5);
    if (p) gps = { at: p.at, lat: p.lat, lng: p.lng, distanceM: a.lat !== null && a.lng !== null ? distanceMetres(p, { lat: a.lat, lng: a.lng }) : null };
  }

  const manque: string[] = [];
  if (!livre) manque.push(a.status === "failed" ? "arrêt en échec" : "arrêt non clôturé");
  if (livre && !lieuConforme) manque.push(a.deliveredPlace ? "lieu de dépôt non conforme" : "lieu de dépôt non renseigné");
  if (livre && !materielle) manque.push("ni photo ni code");

  return {
    stopId: a.id,
    photos,
    lieu: libelleLieu(a.deliveredPlace),
    lieuCode: a.deliveredPlace,
    lieuConforme,
    code: a.proofCode,
    relais: a.relayName,
    clotureA: a.doneAt,
    statut: a.status,
    gps,
    historique: [...evenements]
      .sort((x, y) => x.at.localeCompare(y.at))
      .map((e) => ({ type: e.type, libelle: LIBELLE_EVENEMENT[e.type] ?? e.type, at: e.at, details: e.details })),
    complete,
    verdict: complete ? "Preuve de livraison disponible : contestation défendable." : `Preuve incomplète : ${manque.join(", ")}.`,
  };
}
