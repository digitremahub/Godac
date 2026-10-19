/**
 * Horaires d'ouverture trouvés sur internet → semaine type de l'annuaire
 * (delivery_address_hours.weekly_schedule, lib/colis/horaires.ts).
 *
 * - OpenStreetMap, balise opening_hours (https://wiki.openstreetmap.org/wiki/Key:opening_hours) :
 *   « Mo-Fr 08:00-12:00,14:00-18:00; Sa 09:00-12:00; Su off », « 24/7 »,
 *   « Tu-Sa 9:00-12:00, 14:00-19:00 », « Mo,We,Fr 08:30-12:00 », « 08:00-18:00 »…
 *   Une règle plus loin dans la chaîne remplace la précédente pour les mêmes
 *   jours (sémantique OSM) ; une règle introduite par « , » (règle
 *   additionnelle) s'y ajoute. Les règles qu'on ne sait pas lire avec
 *   certitude (dates, mois, semaines, jours fériés, lever du soleil…) sont
 *   ignorées : on préfère « pas d'horaires » à des horaires inventés.
 * - Google Places (facultatif) : regularOpeningHours.periods.
 *
 * Purement fonctionnel : testé dans lib/colis/__tests__/opening-hours.test.ts.
 */
import { ecrireHeure, lireHeure, normaliserSemaine, type Creneau, type Jour, type Semaine } from "@/lib/colis/horaires";

const JOURS_OSM: Record<string, Jour> = { mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6, su: 7 };
const TOUS: Jour[] = [1, 2, 3, 4, 5, 6, 7];

/** « Mo-Fr,Su » → [1,2,3,4,5,7] ; null si un élément n'est pas un jour (ex. « PH », « Jan »). */
function lireJours(texte: string): Jour[] | null {
  const jours = new Set<Jour>();
  for (const brut of texte.split(",")) {
    const groupe = brut.trim().toLowerCase();
    if (!groupe) continue;
    const m = /^([a-z]{2})(?:\s*-\s*([a-z]{2}))?$/.exec(groupe);
    if (!m) return null;
    const debut = JOURS_OSM[m[1]!];
    const fin = m[2] ? JOURS_OSM[m[2]] : debut;
    if (!debut || !fin) return null;
    let j = debut;
    for (let i = 0; i < 7; i++) {
      jours.add(j);
      if (j === fin) break;
      j = ((j % 7) + 1) as Jour;
    }
  }
  return jours.size ? [...jours].sort() : null;
}

/** « 08:00-12:00,14:00-18:00 » → créneaux ; null si illisible. Après minuit : borné à 24:00. */
function lirePlages(texte: string): Creneau[] | null {
  const morceaux = texte.split(",").map((x) => x.trim()).filter(Boolean);
  if (!morceaux.length) return null;
  const creneaux: Creneau[] = [];
  for (const m of morceaux) {
    const p = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\+?$/.exec(m);
    if (!p) return null;
    const o = lireHeure(p[1]);
    let f = lireHeure(p[2]);
    if (o === null || f === null) {
      // « 26:00 » (après minuit) : borné à minuit.
      const h = Number(p[2]!.split(":")[0]);
      if (o === null || !(h > 24 && h <= 48)) return null;
      f = 1440;
    }
    if (f <= o) f = 1440; // 22:00-02:00 : jusqu'à minuit le jour même.
    creneaux.push({ open: ecrireHeure(o), close: ecrireHeure(f) });
  }
  return creneaux;
}

/**
 * Valeur OSM opening_hours → semaine type ; null si rien n'est lisible de
 * façon sûre. Jours non mentionnés : absents (pas de contrainte connue),
 * sauf si la chaîne décrit explicitement toute la semaine.
 */
export function parserOpeningHours(valeur: string | null | undefined): Semaine | null {
  if (!valeur) return null;
  const texte = valeur.trim();
  if (!texte || texte.length > 600) return null;
  if (/^24\/7(\s+open)?$/i.test(texte)) return Object.fromEntries(TOUS.map((j) => [`${j}`, [{ open: "00:00", close: "24:00" }]])) as Semaine;

  const semaine: Semaine = {};
  let reconnu = false;
  // Règles séparées par « ; » ou « || » (repli). Une règle additionnelle
  // commence par une virgule suivie d'un jour : « Mo-Fr 08:00-12:00, Sa 09:00-12:00 ».
  const regles: { texte: string; additionnelle: boolean }[] = [];
  for (const bloc of texte.split(/;|\|\|/)) {
    const parties = bloc.split(/(?<=\d|off|closed)\s*,\s*(?=(?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)\b)/i);
    parties.forEach((p, i) => p.trim() && regles.push({ texte: p.trim(), additionnelle: i > 0 }));
  }

  for (const { texte: regle, additionnelle } of regles) {
    let r = regle.replace(/\s*"[^"]*"\s*$/, "").replace(/\s+open$/i, "").trim();
    // Jours fériés / vacances scolaires : pas de date ici, on ignore la règle.
    if (/^(PH|SH)\b/i.test(r)) continue;
    // Règle sans jours (« 08:00-18:00 ») : tous les jours.
    let jours: Jour[] | null = TOUS;
    const m = /^([A-Za-z]{2}(?:\s*-\s*[A-Za-z]{2})?(?:\s*,\s*[A-Za-z]{2}(?:\s*-\s*[A-Za-z]{2})?)*)(?:\s+|$)(.*)$/.exec(r);
    if (m && /^[A-Za-z]/.test(r)) {
      // « Mo-Fr,PH 08:00-12:00 » : on garde les jours, sans le férié.
      const sansFeries = m[1]!.split(",").map((x) => x.trim()).filter((x) => !/^(PH|SH)$/i.test(x)).join(",");
      jours = lireJours(sansFeries);
      r = m[2]!.trim();
    }
    if (!jours) continue;
    if (/^(off|closed)$/i.test(r)) {
      for (const j of jours) semaine[`${j}`] = [];
      reconnu = true;
      continue;
    }
    const plages = lirePlages(r);
    if (!plages) continue;
    for (const j of jours) semaine[`${j}`] = additionnelle ? [...(semaine[`${j}`] ?? []), ...plages] : plages;
    reconnu = true;
  }
  if (!reconnu) return null;
  const s = normaliserSemaine(semaine);
  return Object.keys(s).length ? s : null;
}

/** Période Google Places (API « Places (New) » : regularOpeningHours.periods). */
export interface PeriodeGoogle {
  open?: { day?: number; hour?: number; minute?: number };
  close?: { day?: number; hour?: number; minute?: number };
}

/**
 * Périodes Google (day 0 = dimanche) → semaine type. Ouvert 24 h/24 :
 * une seule période sans fermeture. Un jour sans période = fermé (Google
 * liste tous les jours ouverts).
 */
export function convertirPeriodesGoogle(periodes: PeriodeGoogle[] | null | undefined): Semaine | null {
  if (!periodes?.length) return null;
  const iso = (d: number): Jour => (d === 0 ? 7 : (d as Jour));
  if (periodes.length === 1 && periodes[0]!.open && !periodes[0]!.close) return parserOpeningHours("24/7");
  const semaine: Semaine = Object.fromEntries(TOUS.map((j) => [`${j}`, [] as Creneau[]]));
  let lu = false;
  for (const p of periodes) {
    if (p.open?.day === undefined || !p.close) continue;
    const j = iso(p.open.day);
    const o = (p.open.hour ?? 0) * 60 + (p.open.minute ?? 0);
    const memeJour = p.close.day === p.open.day;
    const f = memeJour ? (p.close.hour ?? 0) * 60 + (p.close.minute ?? 0) : 1440;
    if (f <= o) continue;
    semaine[`${j}`] = [...(semaine[`${j}`] ?? []), { open: ecrireHeure(o), close: ecrireHeure(f) }];
    lu = true;
  }
  return lu ? normaliserSemaine(semaine) : null;
}

/** Libellé de l'origine d'une fiche horaires (delivery_address_hours.source). */
export const LIBELLE_SOURCE: Record<string, string> = { openstreetmap: "OpenStreetMap", google: "Google", manuel: "saisie manuelle" };
