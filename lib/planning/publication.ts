/**
 * « Publier aux chauffeurs » : une notification par chauffeur concerné au
 * lieu d'une par changement. Logique pure, partagée par la route
 * (app/api/planning/publier) et la page (nombre de chauffeurs à prévenir) ;
 * testée dans lib/planning/__tests__/publication.test.ts.
 *
 * Fonctionnement (migration 20261030000001_planning_publication.sql) :
 * - semaine pas encore publiée pour un service : rien ne part (comme avant,
 *   planning_validations) ; la publication envoie à chaque chauffeur le
 *   récapitulatif de sa semaine ;
 * - semaine déjà publiée : un changement pour aujourd'hui ou demain prévient
 *   le chauffeur tout de suite (urgent) ; les autres s'accumulent dans
 *   planning_changements, et la publication suivante envoie UN récapitulatif
 *   par chauffeur touché (ajouts, modifications, retraits).
 * Sans la migration (table absente) : la publication envoie le récapitulatif
 * à tous les chauffeurs de la période, les changements unitaires gardent
 * leur notification immédiate.
 */
import { addDays } from "@/lib/planning/dates";
import { heureDe, jourDe, libelleJour, rangJour } from "@/lib/planning/semaine";

export interface AffectationPubliee {
  driver_id: string | null;
  service_id: string;
  tour_number: string;
  start_at: string;
  status: string;
  vehicles?: { registration: string } | null;
}

export interface ChangementAPublier {
  id: string;
  driver_id: string;
  service_id: string | null;
  tour_number: string;
  start_at: string;
  nature: "ajout" | "modif" | "retrait";
}

/** Lundi (jour de Paris) de la semaine d'une date. */
export const lundiDe = (date: string) => addDays(date, -rangJour(date));

/** La publication porte sur des semaines entières : lundi du début → dimanche de la fin. */
export function periodePublication(debut: string, fin: string): { debut: string; fin: string; lundis: string[] } {
  const d = lundiDe(debut <= fin ? debut : fin);
  const f = addDays(lundiDe(debut <= fin ? fin : debut), 6);
  const lundis: string[] = [];
  for (let l = d; l <= f; l = addDays(l, 7)) lundis.push(l);
  return { debut: d, fin: f, lundis };
}

export const cleSemaine = (serviceId: string, lundi: string) => `${serviceId}|${lundi}`;

export interface Destinataire {
  driverId: string;
  /** Ses affectations prévues de la période (récapitulatif complet). */
  entrees: AffectationPubliee[];
  /** Tournées qui lui ont été retirées depuis la dernière publication. */
  retraits: ChangementAPublier[];
}

/**
 * Chauffeurs à prévenir :
 * - `changements` null (table absente) : tous ceux qui ont une affectation ;
 * - sinon : ceux qui ont un changement en attente, plus ceux qui ont une
 *   affectation dans une semaine (service) jamais publiée.
 */
export function destinatairesPublication(params: {
  affectations: readonly AffectationPubliee[];
  changements: readonly ChangementAPublier[] | null;
  /** cleSemaine(service, lundi) déjà publiées. */
  publiees: ReadonlySet<string>;
}): Destinataire[] {
  const prevues = params.affectations.filter((a): a is AffectationPubliee & { driver_id: string } => Boolean(a.driver_id) && a.status === "planned");
  const parChauffeur = new Map<string, AffectationPubliee[]>();
  for (const a of prevues) parChauffeur.set(a.driver_id, [...(parChauffeur.get(a.driver_id) ?? []), a]);

  const concernes = new Set<string>();
  if (params.changements === null) {
    for (const id of parChauffeur.keys()) concernes.add(id);
  } else {
    for (const c of params.changements) concernes.add(c.driver_id);
    for (const a of prevues) if (!params.publiees.has(cleSemaine(a.service_id, lundiDe(jourDe(a.start_at))))) concernes.add(a.driver_id);
  }

  return [...concernes].sort().map((driverId) => {
    const entrees = (parChauffeur.get(driverId) ?? []).sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
    const tenues = new Set(entrees.map((e) => `${e.tour_number}|${Date.parse(e.start_at)}`));
    const vus = new Set<string>();
    const retraits = (params.changements ?? [])
      .filter((c) => c.driver_id === driverId && c.nature === "retrait" && !tenues.has(`${c.tour_number}|${Date.parse(c.start_at)}`))
      .filter((c) => {
        const k = `${c.tour_number}|${Date.parse(c.start_at)}`;
        return vus.has(k) ? false : (vus.add(k), true);
      })
      .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
    return { driverId, entrees, retraits };
  });
}

/** Message de la notification groupée d'un chauffeur. */
export function messagePublication(d: Pick<Destinataire, "entrees" | "retraits">): string {
  const ligne = (e: { start_at: string; tour_number: string; vehicles?: { registration: string } | null }) =>
    `${libelleJour(jourDe(e.start_at))} ${heureDe(e.start_at)} — n°${e.tour_number}${e.vehicles ? ` (${e.vehicles.registration})` : ""}`;
  const parts: string[] = [];
  parts.push(d.entrees.length ? `Votre planning a été mis à jour :\n${d.entrees.map(ligne).join("\n")}` : "Votre planning a été mis à jour : aucune tournée prévue sur la période.");
  if (d.retraits.length) parts.push(`Retirée${d.retraits.length > 1 ? "s" : ""} de votre planning :\n${d.retraits.map((r) => `${libelleJour(jourDe(r.start_at))} — n°${r.tour_number}`).join("\n")}`);
  return parts.join("\n\n");
}

/** « 3 chauffeurs prévenus » / « Personne à prévenir ». */
export function textePublication(n: number): string {
  if (n === 0) return "Personne à prévenir : le planning publié est à jour.";
  return `${n} chauffeur${n > 1 ? "s" : ""} prévenu${n > 1 ? "s" : ""} (une notification chacun).`;
}
