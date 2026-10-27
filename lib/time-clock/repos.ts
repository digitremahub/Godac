import { addDays, parisCalendarDate } from "@/lib/planning/dates";
import { MENTION_A_VALIDER, type ReglesTempsTravail } from "@/lib/pays/temps-travail";

/**
 * Contrôle du repos et de la durée du travail à partir des journées
 * pointées. Fichier pur : alimente l'écran des heures de paie
 * (lib/paie/donnees.ts) et « À traiter » (lib/a-traiter/serveur.ts).
 * Les résultats sont des AVERTISSEMENTS non bloquants, à valider avec
 * l'expert paie ou la convention collective (MENTION_A_VALIDER) ; les
 * seuils viennent de lib/pays/temps-travail.ts. Le seuil « plus de 6 h sans
 * pause » est déjà contrôlé par lib/paie/heures.ts (alerte « sans_pause »).
 */

export type CodeControleRepos = "repos_quotidien" | "amplitude" | "duree_hebdo" | "jours_consecutifs";

export const LIBELLE_CONTROLE_REPOS: Record<CodeControleRepos, string> = {
  repos_quotidien: "Repos quotidien insuffisant",
  amplitude: "Amplitude de la journée trop longue",
  duree_hebdo: "Durée hebdomadaire dépassée",
  jours_consecutifs: "Trop de jours consécutifs",
};

/** Journée travaillée : compatible avec JourHeures (lib/paie/heures.ts). */
export interface JourTravaille {
  jour: string;
  /** Premier début et dernière fin de la journée (instants ISO). */
  debut: string | null;
  fin: string | null;
  heures: number;
}

export interface AvertissementRepos {
  code: CodeControleRepos;
  /** Jour concerné (AAAA-MM-JJ, jour de Paris) : le lendemain d'un repos trop court, le lundi d'une semaine trop longue. */
  jour: string;
  message: string;
}

const HEURE = 3_600_000;
const hm = (h: number) => {
  const total = Math.round(h * 60);
  return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, "0")}`;
};
const dateCourte = (jour: string) => `${jour.slice(8, 10)}/${jour.slice(5, 7)}`;

/** Lundi de la semaine du jour donné (AAAA-MM-JJ). */
export function lundiDe(jour: string): string {
  const d = new Date(`${jour}T12:00:00Z`).getUTCDay();
  return addDays(jour, -((d + 6) % 7));
}

/**
 * Avertissements pour ces journées (triées ou non). Seules les journées
 * avec des heures comptées jouent. Un repos s'évalue entre deux journées
 * travaillées successives, même si elles ne sont pas voisines.
 */
export function controlerTempsTravail(jours: readonly JourTravaille[], regles: ReglesTempsTravail): AvertissementRepos[] {
  const travaillees = jours.filter((j) => j.heures > 0).sort((a, b) => a.jour.localeCompare(b.jour));
  const resultat: AvertissementRepos[] = [];

  for (const j of travaillees) {
    if (!j.debut || !j.fin) continue;
    const amplitude = (Date.parse(j.fin) - Date.parse(j.debut)) / HEURE;
    if (amplitude > regles.amplitudeMaxHeures) {
      resultat.push({ code: "amplitude", jour: j.jour, message: `Le ${dateCourte(j.jour)} : amplitude de ${hm(amplitude)} (${regles.amplitudeMaxHeures} h au plus).` });
    }
  }

  for (let i = 1; i < travaillees.length; i++) {
    const veille = travaillees[i - 1]!;
    const jour = travaillees[i]!;
    if (!veille.fin || !jour.debut) continue;
    const repos = (Date.parse(jour.debut) - Date.parse(veille.fin)) / HEURE;
    if (repos >= 0 && repos < regles.reposQuotidienMinHeures) {
      resultat.push({
        code: "repos_quotidien",
        jour: jour.jour,
        message: `Repos de ${hm(repos)} entre le ${dateCourte(veille.jour)} et le ${dateCourte(jour.jour)} (${regles.reposQuotidienMinHeures} h au moins).`,
      });
    }
  }

  const parSemaine = new Map<string, number>();
  for (const j of travaillees) {
    const lundi = lundiDe(j.jour);
    parSemaine.set(lundi, (parSemaine.get(lundi) ?? 0) + j.heures);
  }
  for (const [lundi, total] of parSemaine) {
    if (total > regles.dureeHebdoMaxHeures) {
      resultat.push({ code: "duree_hebdo", jour: lundi, message: `Semaine du ${dateCourte(lundi)} : ${hm(total)} travaillées (${regles.dureeHebdoMaxHeures} h au plus).` });
    }
  }

  let serie: string[] = [];
  const clore = () => {
    if (serie.length > regles.joursConsecutifsMax) {
      resultat.push({
        code: "jours_consecutifs",
        jour: serie[regles.joursConsecutifsMax]!,
        message: `${serie.length} jours travaillés de suite du ${dateCourte(serie[0]!)} au ${dateCourte(serie[serie.length - 1]!)} (${regles.joursConsecutifsMax} au plus, sans repos hebdomadaire).`,
      });
    }
    serie = [];
  };
  for (const j of travaillees) {
    if (serie.length && addDays(serie[serie.length - 1]!, 1) !== j.jour) clore();
    serie.push(j.jour);
  }
  clore();

  return resultat.sort((a, b) => a.jour.localeCompare(b.jour) || a.code.localeCompare(b.code));
}

/** Texte unique d'un avertissement avec la mention de validation (À traiter, exports). */
export function texteAvertissement(a: Pick<AvertissementRepos, "message">): string {
  return `${a.message} (${MENTION_A_VALIDER})`;
}

/**
 * Journées travaillées à partir de pointages bruts : par jour de Paris de
 * l'entrée, premier début, dernière sortie, heures des sessions complètes.
 * Une entrée encore ouverte compte pour son début mais pas pour des heures.
 */
export function joursDepuisPointages(pointages: readonly { entree: string; sortie: string | null }[]): JourTravaille[] {
  const parJour = new Map<string, { debut: number; fin: number | null; ms: number }>();
  for (const p of pointages) {
    const jour = parisCalendarDate(p.entree);
    const e = Date.parse(p.entree);
    const s = p.sortie ? Date.parse(p.sortie) : null;
    const courant = parJour.get(jour) ?? { debut: e, fin: null, ms: 0 };
    courant.debut = Math.min(courant.debut, e);
    if (s !== null && s > e) {
      courant.fin = Math.max(courant.fin ?? s, s);
      courant.ms += s - e;
    }
    parJour.set(jour, courant);
  }
  return [...parJour.entries()]
    .filter(([, v]) => v.ms > 0)
    .map(([jour, v]) => ({ jour, debut: new Date(v.debut).toISOString(), fin: v.fin !== null ? new Date(v.fin).toISOString() : null, heures: Math.round((v.ms / HEURE) * 100) / 100 }))
    .sort((a, b) => a.jour.localeCompare(b.jour));
}
