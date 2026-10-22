import { addDays, parisCalendarDate } from "@/lib/planning/dates";

// Heures travaillées du mois pour la préparation du bulletin — logique
// pure, testée dans lib/paie/__tests__/heures.test.ts.
//
// Règle par défaut (« regle ») :
// - conducteur (chauffeur, ou manager / exploitation qui conduit) : il
//   fait du picking au dépôt avant de partir. DÉBUT de journée = pointage
//   d'arrivée s'il existe, sinon heure de début PRÉVUE au planning de la
//   journée (jamais l'heure du bouton Départ, sauf si le début prévu est
//   inconnu) ; FIN = pointage de sortie s'il existe, sinon Retour de la
//   dernière tournée du jour (toutes ses tournées du jour comptent) ;
// - autres salariés (bureau…) : pointage seul ; un jour planifié sans
//   pointage prend les horaires prévus, signalé « jour sans pointage » ;
// - pauses : les interruptions pointées (sortie puis nouvelle entrée) sont
//   déduites ; aucune déduction automatique, mais un avertissement au-delà
//   de 6 h sans pause pointée ;
// - jours d'arrêt ou de congé : aucune heure attendue (une activité
//   réelle ces jours-là compte, avec un avertissement).
// Options d'entreprise : « badge » (pointage seul, pour tous) et
// « tournees » (Départ → Retour des tournées et présences planifiées,
// l'ancienne règle). La paie garde la main sur le total.

export type SourceHeures = "regle" | "badge" | "tournees";

export const LIBELLE_SOURCE_HEURES: Record<SourceHeures, string> = {
  regle: "Pointage, sinon planning prévu et retour de tournée (recommandé)",
  badge: "Pointage seul",
  tournees: "Départ → retour des tournées (sans pointage)",
};

export function sourceHeures(v: unknown): SourceHeures {
  return v === "badge" || v === "tournees" ? v : "regle";
}

/** Session de pointeuse (time_clock_entries). */
export interface Pointage {
  entree: string;
  sortie: string | null;
}

/** Affectation du planning (planning_entries) du salarié. */
export interface EntreePlanning {
  /** start_at : heure de Départ réelle une fois la tournée démarrée. */
  debut: string;
  /** planned_start_at : début prévu (null : inconnu, affectation antérieure). */
  debutPrevu?: string | null;
  /** end_at : Retour (tournée terminée) ou fin prévue (présence). */
  fin: string | null;
  status: string;
}

export interface AbsenceJours {
  du: string;
  au: string;
  nature: "arret" | "conges";
}

export type OrigineDebut = "badge" | "planning" | "depart";
export type OrigineFin = "badge" | "retour" | "planning";

export type CodeAlerteHeures = "ecart_retour" | "pointage_incomplet" | "sans_source" | "sans_pause" | "sans_pointage" | "pendant_absence";

export interface AlerteHeures {
  jour: string;
  code: CodeAlerteHeures;
  message: string;
}

export interface JourHeures {
  jour: string;
  debut: string | null;
  fin: string | null;
  origineDebut: OrigineDebut | null;
  origineFin: OrigineFin | null;
  pauseMinutes: number;
  heures: number;
  absence: AbsenceJours["nature"] | null;
}

export interface HeuresDuMois {
  source: SourceHeures;
  total: number;
  joursTravailles: number;
  jours: JourHeures[];
  alertes: AlerteHeures[];
}

export const PRESENCE = "presence";
const ANNULEES = new Set(["cancelled", "canceled", "annule", "annulee"]);
const TOURNEE = new Set(["done", "in_progress"]);
/** Écart toléré entre le pointage de sortie et le Retour de tournée. */
export const ECART_RETOUR_MINUTES = 30;
/** Au-delà, une journée sans pause pointée est signalée. */
export const SEUIL_PAUSE_HEURES = 6;

const ms = (iso: string) => Date.parse(iso);
const h2 = (n: number) => Math.round(n * 100) / 100;
const heureParis = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });

function grouper<T>(items: readonly T[], jourDe: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of items) {
    const j = jourDe(x);
    m.set(j, [...(m.get(j) ?? []), x]);
  }
  return m;
}

function absenceDuJour(absences: readonly AbsenceJours[], jour: string): AbsenceJours["nature"] | null {
  // Un arrêt prime sur un congé le même jour.
  const a = absences.filter((x) => x.du <= jour && x.au >= jour);
  if (a.some((x) => x.nature === "arret")) return "arret";
  return a.length ? "conges" : null;
}

/** Sessions complètes triées, et pauses (écarts entre deux sessions). */
function sessions(pointages: readonly Pointage[]): { completes: { e: number; s: number }[]; pauseMs: number } {
  const completes = pointages
    .filter((p) => p.sortie && ms(p.sortie) > ms(p.entree))
    .map((p) => ({ e: ms(p.entree), s: ms(p.sortie!) }))
    .sort((a, b) => a.e - b.e);
  let pauseMs = 0;
  for (let i = 1; i < completes.length; i++) pauseMs += Math.max(0, completes[i]!.e - completes[i - 1]!.s);
  return { completes, pauseMs };
}

/**
 * Heures du mois, jour par jour, avec la source utilisée et les alertes.
 * `maintenant` : les jours à venir sont ignorés ; un pointage encore
 * ouvert aujourd'hui n'est pas « incomplet ».
 */
export function heuresDuMois(p: {
  debut: string;
  fin: string;
  pointages: readonly Pointage[];
  planning: readonly EntreePlanning[];
  absences: readonly AbsenceJours[];
  profil: { conducteur: boolean };
  source?: SourceHeures;
  maintenant?: Date;
}): HeuresDuMois {
  const source = p.source ?? "regle";
  const maintenant = p.maintenant ?? new Date();
  const aujourdhui = parisCalendarDate(maintenant.toISOString());
  const pointagesParJour = grouper(p.pointages, (x) => parisCalendarDate(x.entree));
  const planningParJour = grouper(
    p.planning.filter((e) => !ANNULEES.has(e.status)),
    (e) => parisCalendarDate(e.debutPrevu ?? e.debut),
  );

  const jours: JourHeures[] = [];
  const alertes: AlerteHeures[] = [];
  const alerte = (jour: string, code: CodeAlerteHeures, message: string) => alertes.push({ jour, code, message });

  for (let jour = p.debut; jour <= p.fin && jour <= aujourdhui; jour = addDays(jour, 1)) {
    const absence = absenceDuJour(p.absences, jour);
    const badges = pointagesParJour.get(jour) ?? [];
    const entrees = planningParJour.get(jour) ?? [];
    const tournees = entrees.filter((e) => TOURNEE.has(e.status));
    const presences = entrees.filter((e) => e.status === PRESENCE);
    const termine = jour < aujourdhui;
    const ouverts = badges.filter((b) => !b.sortie);
    if (ouverts.length && termine) alerte(jour, "pointage_incomplet", `Pointage d'entrée à ${heureParis(ouverts[0]!.entree)} sans pointage de sortie.`);

    const { completes, pauseMs } = sessions(badges);
    let debut: number | null = null;
    let fin: number | null = null;
    let origineDebut: OrigineDebut | null = null;
    let origineFin: OrigineFin | null = null;
    let pause = 0;
    let heures = 0;

    if (source === "tournees") {
      // Ancienne règle : Départ → Retour de chaque tournée terminée, et
      // présences planifiées (pôles bureau) une fois la journée finie.
      const comptees = [...tournees.filter((e) => e.status === "done" && e.fin), ...presences.filter((e) => e.fin && ms(e.fin) <= maintenant.getTime())];
      heures = comptees.reduce((s, e) => s + Math.max(0, ms(e.fin!) - ms(e.debut)) / 3_600_000, 0);
      if (comptees.length) {
        debut = Math.min(...comptees.map((e) => ms(e.debut)));
        fin = Math.max(...comptees.map((e) => ms(e.fin!)));
        origineDebut = tournees.length ? "depart" : "planning";
        origineFin = tournees.length ? "retour" : "planning";
      }
    } else {
      const premierBadge = badges.length ? Math.min(...badges.map((b) => ms(b.entree))) : null;
      const derniereSortie = completes.length ? Math.max(...completes.map((c) => c.s)) : null;
      const conducteur = source === "regle" && p.profil.conducteur;
      if (premierBadge !== null) {
        debut = premierBadge;
        origineDebut = "badge";
      }
      if (derniereSortie !== null) {
        fin = derniereSortie;
        origineFin = "badge";
      }
      const retours = tournees.filter((e) => e.status === "done" && e.fin).map((e) => ms(e.fin!));
      const dernierRetour = retours.length ? Math.max(...retours) : null;
      if (conducteur) {
        if (debut === null && entrees.length) {
          const prevus = entrees.filter((e) => e.debutPrevu).map((e) => ms(e.debutPrevu!));
          if (prevus.length) {
            debut = Math.min(...prevus);
            origineDebut = "planning";
          } else if (tournees.length) {
            debut = Math.min(...tournees.map((e) => ms(e.debut)));
            origineDebut = "depart";
          }
        }
        if (fin === null && dernierRetour !== null) {
          fin = dernierRetour;
          origineFin = "retour";
        }
        // Journée de présence (bureau) d'un conducteur, sans tournée : fin prévue, une fois passée.
        const finsPresence = presences.filter((e) => e.fin && ms(e.fin) <= maintenant.getTime()).map((e) => ms(e.fin!));
        if (fin === null && !tournees.length && finsPresence.length) {
          fin = Math.max(...finsPresence);
          origineFin = "planning";
          if (premierBadge === null) alerte(jour, "sans_pointage", "Jour de présence sans pointage : horaires prévus retenus, à vérifier.");
        }
        if (derniereSortie !== null && dernierRetour !== null && Math.abs(derniereSortie - dernierRetour) > ECART_RETOUR_MINUTES * 60_000) {
          alerte(jour, "ecart_retour", `Pointage de sortie à ${heureParis(new Date(derniereSortie).toISOString())}, retour de tournée à ${heureParis(new Date(dernierRetour).toISOString())} (écart de plus de ${ECART_RETOUR_MINUTES} min).`);
        }
      } else if (badges.length === 0 && termine && !absence) {
        // Bureau (ou option « pointage seul ») : pas de pointage un jour planifié.
        const planifies = entrees.filter((e) => e.fin);
        if (source === "regle" && planifies.length) {
          debut = Math.min(...planifies.map((e) => ms(e.debutPrevu ?? e.debut)));
          fin = Math.max(...planifies.map((e) => ms(e.fin!)));
          origineDebut = "planning";
          origineFin = "planning";
          alerte(jour, "sans_pointage", "Jour planifié sans pointage : horaires prévus retenus, à vérifier.");
        } else if (entrees.length) {
          alerte(jour, "sans_pointage", "Jour planifié sans pointage : aucune heure comptée.");
        }
      }

      if (debut !== null && fin !== null && fin > debut) {
        // Pauses pointées seulement quand le pointage borne les deux bouts.
        pause = origineDebut === "badge" && origineFin === "badge" ? pauseMs : 0;
        heures = Math.max(0, fin - debut - pause) / 3_600_000;
      } else if (termine && (badges.length || tournees.length)) {
        if (!ouverts.length) alerte(jour, "sans_source", "Activité ce jour-là, mais ni pointage complet ni retour de tournée : aucune heure comptée.");
      } else if (termine && conducteur && entrees.length && !absence && entrees.some((e) => e.status !== "planned")) {
        alerte(jour, "sans_source", "Jour travaillé sans pointage ni retour de tournée : aucune heure comptée.");
      }
      if (heures > SEUIL_PAUSE_HEURES && pause === 0) alerte(jour, "sans_pause", `${h2(heures).toString().replace(".", ",")} h sans pause pointée : vérifiez la pause.`);
    }

    if (absence && heures > 0) alerte(jour, "pendant_absence", `Activité enregistrée pendant ${absence === "arret" ? "un arrêt de travail" : "un congé"} : à vérifier.`);
    if (heures > 0 || absence) {
      jours.push({
        jour,
        debut: debut !== null ? new Date(debut).toISOString() : null,
        fin: fin !== null ? new Date(fin).toISOString() : null,
        origineDebut: heures > 0 ? origineDebut : null,
        origineFin: heures > 0 ? origineFin : null,
        pauseMinutes: Math.round(pause / 60_000),
        heures: h2(heures),
        absence,
      });
    }
  }

  const travailles = jours.filter((j) => j.heures > 0);
  return { source, total: h2(travailles.reduce((s, j) => s + j.heures, 0)), joursTravailles: travailles.length, jours, alertes };
}

export const LIBELLE_ORIGINE: Record<OrigineDebut | OrigineFin, string> = {
  badge: "pointage",
  planning: "planning prévu",
  depart: "départ tournée",
  retour: "retour tournée",
};
