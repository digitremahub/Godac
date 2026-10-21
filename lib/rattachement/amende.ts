/**
 * Rapprochement amende ↔ planning (logique pure, testée dans
 * lib/rattachement/__tests__/amende.test.ts).
 *
 * Qui avait CE véhicule à CE moment-là ?
 *  1. Créneau de planning réalisé (en cours / terminé) du véhicule dont
 *     la fenêtre start_at ≤ heure ≤ end_at couvre l'infraction (end_at
 *     absent : tournée en cours, jusqu'à la fin de la journée) → exact.
 *  2. Changement de véhicule (photos de passage de main,
 *     vehicle_change_photos) : le chauffeur qui a pris le véhicule à
 *     l'heure H l'a depuis H. En cas de passage de main, le dernier à
 *     l'avoir pris avant l'infraction l'emporte. Un changement en cours
 *     de tournée constaté seulement au retour (heure inconnue) ne donne
 *     qu'un « probable ».
 *  3. Tournée colis du jour avec ce véhicule : un point GPS enregistré à
 *     ±15 min de l'infraction confirme (exact), sinon même jour (probable).
 *  4. Créneau du même jour hors heure, ou seulement prévu → probable.
 * Plusieurs chauffeurs au même niveau, ou aucun : pas de suggestion,
 * l'encadrement choisit à la main.
 */
import { parisCalendarDate, parisWallTimeToUtcISOString } from "@/lib/planning/dates";
import { pointLePlusProche } from "@/lib/rattachement/format";

export type Confiance = "exact" | "probable" | "aucun";

export interface CreneauPlanning {
  id: string;
  driverId: string | null;
  driverName: string;
  tourNumber: string | null;
  /** Véhicule enregistré sur le créneau (celui du retour en cas de changement). */
  vehicleId: string | null;
  startAt: string;
  endAt: string | null;
  status: string;
}

/** Prise d'un véhicule constatée par les photos de changement (une par créneau / véhicule / étape). */
export interface PriseVehicule {
  planningEntryId: string;
  vehicleId: string;
  driverId: string | null;
  stage: "depart" | "retour";
  at: string;
}

export interface TourneeColis {
  runId: string;
  driverId: string;
  driverName: string;
  vehicleId: string | null;
  runDate: string;
  planningEntryId: string | null;
}

export interface PointGps {
  runId: string;
  at: string;
  lat: number;
  lng: number;
}

export interface CandidatAmende {
  driverId: string;
  driverName: string;
  planningEntryId: string | null;
  runId: string | null;
  tourNumber: string | null;
  debut: string | null;
  fin: string | null;
  confiance: Exclude<Confiance, "aucun">;
  raison: string;
  /** Moment où ce chauffeur a pris le véhicule (départage d'un passage de main). */
  priseA: string | null;
  gps: { at: string; lat: number; lng: number } | null;
}

export interface ResultatAmende {
  confiance: Confiance;
  suggestion: CandidatAmende | null;
  candidats: CandidatAmende[];
  raison: string;
}

const REALISE = new Set(["in_progress", "done"]);
const IGNORE = new Set(["cancelled", "canceled", "absent"]);
const MARGE_GPS_MIN = 15;

/** Fin de la journée de Paris d'un instant (23:59 heure locale). */
function finDeJourneeParis(iso: string): number {
  return Date.parse(parisWallTimeToUtcISOString(parisCalendarDate(iso), "23:59")) + 59_999;
}

const rang = (c: Confiance) => (c === "exact" ? 2 : c === "probable" ? 1 : 0);

export function rapprocherAmende(p: {
  vehicleId: string;
  infractionAt: string;
  creneaux: readonly CreneauPlanning[];
  prises?: readonly PriseVehicule[];
  tournees?: readonly TourneeColis[];
  points?: readonly PointGps[];
}): ResultatAmende {
  const t = Date.parse(p.infractionAt);
  const jour = parisCalendarDate(p.infractionAt);
  const prises = p.prises ?? [];
  const tournees = p.tournees ?? [];
  const points = p.points ?? [];
  const parChauffeur = new Map<string, CandidatAmende>();

  const retenir = (c: CandidatAmende) => {
    const actuel = parChauffeur.get(c.driverId);
    if (!actuel || rang(c.confiance) > rang(actuel.confiance) || (c.confiance === actuel.confiance && (c.priseA ?? "") > (actuel.priseA ?? ""))) {
      parChauffeur.set(c.driverId, { ...c, gps: c.gps ?? actuel?.gps ?? null });
    } else if (!actuel.gps && c.gps) {
      actuel.gps = c.gps;
    }
  };

  for (const e of p.creneaux) {
    if (!e.driverId || IGNORE.has(e.status)) continue;
    const prisesE = prises.filter((x) => x.planningEntryId === e.id).sort((a, b) => a.at.localeCompare(b.at));
    const concerneVehicule = e.vehicleId === p.vehicleId || prisesE.some((x) => x.vehicleId === p.vehicleId);
    if (!concerneVehicule) continue;

    const debut = Date.parse(e.startAt);
    const realise = REALISE.has(e.status);
    const fin = e.endAt ? Date.parse(e.endAt) : e.status === "in_progress" ? finDeJourneeParis(e.startAt) : null;
    const couvert = fin !== null && debut <= t && t <= fin;
    const base = {
      driverId: e.driverId,
      driverName: e.driverName,
      planningEntryId: e.id,
      runId: null,
      tourNumber: e.tourNumber,
      debut: e.startAt,
      fin: e.endAt,
      gps: null,
    };

    if (couvert && realise) {
      // Véhicule tenu à l'heure de l'infraction.
      const derniere = [...prisesE].reverse().find((x) => Date.parse(x.at) <= t && x.stage === "depart");
      const retourApres = prisesE.find((x) => x.stage === "retour" && Date.parse(x.at) >= t);
      if (derniere) {
        if (derniere.vehicleId === p.vehicleId) {
          retenir({ ...base, confiance: "exact", priseA: derniere.at, raison: `véhicule pris au changement de ${hhmm(derniere.at)}` });
          continue;
        }
        // Le chauffeur avait un autre véhicule à cette heure-là.
        if (!retourApres) {
          retenir({ ...base, confiance: "probable", priseA: null, raison: "même jour, mais avec un autre véhicule à cette heure-là" });
          continue;
        }
      }
      if (retourApres) {
        // Changement en cours de tournée, constaté au retour : heure du passage inconnue.
        retenir({ ...base, confiance: "probable", priseA: null, raison: "changement de véhicule en cours de tournée (heure inconnue)" });
        continue;
      }
      if (e.vehicleId === p.vehicleId) {
        retenir({ ...base, confiance: "exact", priseA: e.startAt, raison: "heure couverte par la tournée" });
        continue;
      }
    }

    if (parisCalendarDate(e.startAt) === jour) {
      retenir({
        ...base,
        confiance: "probable",
        priseA: null,
        raison: realise ? (couvert ? "même jour, véhicule incertain à cette heure" : "même jour, hors des horaires de la tournée") : "prévu au planning ce jour-là (tournée non pointée)",
      });
    }
  }

  // Tournées colis du jour avec ce véhicule, et position GPS.
  for (const r of tournees) {
    if (r.runDate !== jour || !r.driverId) continue;
    const pointsRun = points.filter((x) => x.runId === r.runId);
    const proche = pointLePlusProche(pointsRun, p.infractionAt, MARGE_GPS_MIN);
    const gps = proche ? { at: proche.at, lat: proche.lat, lng: proche.lng } : null;
    if (r.vehicleId !== p.vehicleId) {
      // Même chauffeur déjà candidat : la position s'ajoute à titre d'indice.
      const deja = parChauffeur.get(r.driverId);
      if (deja && gps && !deja.gps) deja.gps = gps;
      continue;
    }
    const deja = parChauffeur.get(r.driverId);
    if (gps) {
      retenir({
        driverId: r.driverId,
        driverName: r.driverName,
        planningEntryId: deja?.planningEntryId ?? r.planningEntryId,
        runId: r.runId,
        tourNumber: deja?.tourNumber ?? null,
        debut: deja?.debut ?? null,
        fin: deja?.fin ?? null,
        confiance: "exact",
        priseA: deja?.confiance === "exact" ? deja.priseA : null,
        raison: deja?.confiance === "exact" ? `${deja.raison}, position GPS à ${hhmm(gps.at)}` : `tournée colis avec ce véhicule, position GPS à ${hhmm(gps.at)}`,
        gps,
      });
    } else if (!deja) {
      retenir({
        driverId: r.driverId,
        driverName: r.driverName,
        planningEntryId: r.planningEntryId,
        runId: r.runId,
        tourNumber: null,
        debut: null,
        fin: null,
        confiance: "probable",
        priseA: null,
        raison: "tournée colis du jour avec ce véhicule",
        gps: null,
      });
    } else if (!deja.runId) {
      deja.runId = r.runId;
    }
  }

  const candidats = [...parChauffeur.values()].sort((a, b) => rang(b.confiance) - rang(a.confiance) || (b.priseA ?? "").localeCompare(a.priseA ?? "") || a.driverName.localeCompare(b.driverName, "fr"));
  if (candidats.length === 0) return { confiance: "aucun", suggestion: null, candidats, raison: "Aucun chauffeur trouvé au planning pour ce véhicule ce jour-là." };

  const exacts = candidats.filter((c) => c.confiance === "exact");
  if (exacts.length === 1) return { confiance: "exact", suggestion: exacts[0]!, candidats, raison: exacts[0]!.raison };
  if (exacts.length > 1) {
    // Passage de main : le dernier à avoir pris le véhicule avant l'infraction.
    const [a, b] = exacts as [CandidatAmende, CandidatAmende];
    if (a.priseA && b.priseA && a.priseA > b.priseA) {
      return { confiance: "exact", suggestion: a, candidats, raison: `${a.raison} (véhicule repris après ${b.driverName})` };
    }
    return { confiance: "exact", suggestion: null, candidats, raison: "Plusieurs chauffeurs avaient ce véhicule à cette heure-là : choisissez." };
  }
  if (candidats.length === 1) return { confiance: "probable", suggestion: candidats[0]!, candidats, raison: candidats[0]!.raison };
  return { confiance: "probable", suggestion: null, candidats, raison: "Plusieurs chauffeurs possibles ce jour-là : choisissez." };
}

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
}

/** « Suggestion : Jean Dupont, tournée n°12, véhicule AB-123-CD, de 07:10 à 16:45 ». */
export function libelleSuggestionAmende(c: Pick<CandidatAmende, "driverName" | "tourNumber" | "debut" | "fin">, immatriculation: string | null): string {
  const morceaux = [`Suggestion : ${c.driverName}`];
  if (c.tourNumber) morceaux.push(`tournée n°${c.tourNumber}`);
  if (immatriculation) morceaux.push(`véhicule ${immatriculation}`);
  let texte = morceaux.join(", ");
  if (c.debut) texte += `, de ${hhmm(c.debut)} à ${c.fin ? hhmm(c.fin) : "en cours"}`;
  return texte;
}

export const LIBELLE_CONFIANCE: Record<Confiance, string> = {
  exact: "Exact (heure couverte)",
  probable: "Probable (même jour)",
  aucun: "Aucun",
};
