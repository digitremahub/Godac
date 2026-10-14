
/**
 * Horaires d'ouverture des adresses professionnelles dans la tournée colis.
 *
 * - Annuaire de l'entreprise (table delivery_address_hours) : semaine type
 *   d'une adresse, 0 à 2 créneaux par jour.
 * - Créneau ponctuel d'un arrêt (window_start / window_end) prioritaire.
 * - Conversion des horaires OpenStreetMap simples pour l'optimisation.
 */
import { distanceKm, optimiserOrdre, type Point } from "@/lib/colis/optimisation";
import { MINUTES_PAR_ARRET, minutesTrajet } from "@/lib/colis/estimation";
import { dateParis, jourIso, minutesParis } from "@/lib/colis/heure-paris";

export { dateParis, instantParis, jourIso, minutesParis } from "@/lib/colis/heure-paris";

export type Jour = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export interface Creneau {
  open: string;
  close: string;
}
export type Semaine = Partial<Record<`${Jour}`, Creneau[]>>;
export type Fenetres = [number, number][] | null;

export const JOURS: { n: Jour; court: string; long: string }[] = [
  { n: 1, court: "Lun", long: "Lundi" },
  { n: 2, court: "Mar", long: "Mardi" },
  { n: 3, court: "Mer", long: "Mercredi" },
  { n: 4, court: "Jeu", long: "Jeudi" },
  { n: 5, court: "Ven", long: "Vendredi" },
  { n: 6, court: "Sam", long: "Samedi" },
  { n: 7, court: "Dim", long: "Dimanche" },
];

export interface FicheHoraires {
  id: string;
  address_key: string;
  label: string | null;
  address: string;
  weekly_schedule: Semaine;
  notes: string | null;
  updated_at: string;
}

export const MAX_CRENEAUX = 2;
export const DEPART_PAR_DEFAUT = 8 * 60;

export function lireHeure(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = /^\s*(\d{1,2})\s*(?:[:h]\s*(\d{2})?)?(?::\d{2})?\s*$/i.exec(v);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

export function ecrireHeure(minutes: number): string {
  const m = Math.max(0, Math.min(1440, Math.round(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function afficherHeure(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

function normaliserJour(v: unknown): Creneau[] {
  if (!Array.isArray(v)) return [];
  const bruts = v
    .map((c): [number | null, number | null] =>
      c && typeof c === "object"
        ? [
            lireHeure((c as Creneau).open),
            lireHeure((c as Creneau).close),
          ]
        : [null, null]
    )
    .filter(
      (c): c is [number, number] =>
        c[0] !== null && c[1] !== null && c[0] < c[1]
    )
    .sort((a, b) => a[0] - b[0]);

  const fusion: [number, number][] = [];
  for (const c of bruts) {
    const der = fusion[fusion.length - 1];
    if (der && c[0] <= der[1]) der[1] = Math.max(der[1], c[1]);
    else fusion.push([...c]);
  }

  return fusion
    .slice(0, MAX_CRENEAUX)
    .map(([o, f]) => ({ open: ecrireHeure(o), close: ecrireHeure(f) }));
}

export function normaliserSemaine(v: unknown): Semaine {
  const s: Semaine = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return s;

  for (const { n } of JOURS) {
    const jour = (v as Record<string, unknown>)[String(n)];
    if (jour !== undefined && jour !== null) {
      s[`${n}`] = normaliserJour(jour);
    }
  }
  return s;
}

/**
 * Convertit les horaires OpenStreetMap simples, par exemple :
 * "Mo-Fr 08:00-12:00,14:00-18:00; Sa 09:00-12:00; Su off".
 * Les formats complexes ou ambigus sont ignorés.
 */
export function convertirHorairesOSM(
  value: string | null | undefined
): Semaine | null {
  if (!value || value.length > 500) return null;

  const jourIndex: Record<string, Jour> = {
    Mo: 1,
    Tu: 2,
    We: 3,
    Th: 4,
    Fr: 5,
    Sa: 6,
    Su: 7,
  };

  const semaine: Record<string, Creneau[]> = {};
  const parties = value.split(";").map((p) => p.trim()).filter(Boolean);

  for (const partie of parties) {
    const match = /^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?(?:,(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?)*\s+(.+)$/i.exec(
      partie
    );
    if (!match) continue;

    const separateur = partie.search(/\s/);
    if (separateur < 0) continue;

    const joursTexte = partie.slice(0, separateur).trim();
    const horairesTexte = partie.slice(separateur + 1).trim();
    const joursActifs = new Set<Jour>();

    for (const plage of joursTexte.split(",")) {
      const [debut, fin] = plage.split("-");
      const jDebut = jourIndex[debut!];
      const jFin = fin ? jourIndex[fin] : jDebut;
      if (!jDebut || !jFin) continue;

      let j = jDebut;
      for (let garde = 0; garde < 7; garde++) {
        joursActifs.add(j);
        if (j === jFin) break;
        j = ((j % 7) + 1) as Jour;
      }
    }

    if (/^(off|closed)$/i.test(horairesTexte)) {
      for (const j of joursActifs) semaine[String(j)] = [];
      continue;
    }

    const creneaux: Creneau[] = [];
    const plages = horairesTexte.match(/\d{1,2}:\d{2}-\d{1,2}:\d{2}/g) ?? [];

    for (const plage of plages) {
      const [debut, fin] = plage.split("-");
      const ouverture = lireHeure(debut);
      const fermeture = lireHeure(fin);

      if (
        ouverture !== null &&
        fermeture !== null &&
        ouverture < fermeture
      ) {
        creneaux.push({
          open: ecrireHeure(ouverture),
          close: ecrireHeure(fermeture),
        });
      }
    }

    if (!creneaux.length) continue;

    for (const j of joursActifs) {
      semaine[String(j)] = [
        ...(semaine[String(j)] ?? []),
        ...creneaux,
      ];
    }
  }

  if (!Object.keys(semaine).length) return null;
  return normaliserSemaine(semaine);
}

export function creneauxDuJour(
  semaine: Semaine | null | undefined,
  jour: Jour
): Creneau[] | null {
  return semaine?.[`${jour}`] ?? null;
}

const SEMAINE_OUVREE: Jour[] = [1, 2, 3, 4, 5];

export function appliquerDuLundiAuVendredi(
  semaine: Semaine,
  creneaux: Creneau[]
): Semaine {
  const s = { ...semaine };
  for (const j of SEMAINE_OUVREE) {
    s[`${j}`] = creneaux.map((c) => ({ ...c }));
  }
  return s;
}

export const PRESETS: {
  cle: string;
  libelle: string;
  appliquer: (s: Semaine) => Semaine;
}[] = [
  {
    cle: "coupure",
    libelle: "8h–12h / 14h–18h du lundi au vendredi",
    appliquer: (s) =>
      appliquerDuLundiAuVendredi(s, [
        { open: "08:00", close: "12:00" },
        { open: "14:00", close: "18:00" },
      ]),
  },
  {
    cle: "continue",
    libelle: "Journée continue 8h–18h",
    appliquer: (s) =>
      appliquerDuLundiAuVendredi(s, [
        { open: "08:00", close: "18:00" },
      ]),
  },
  {
    cle: "samedi",
    libelle: "Fermé le samedi",
    appliquer: (s) => ({ ...s, "6": [] }),
  },
  {
    cle: "dimanche",
    libelle: "Fermé le dimanche",
    appliquer: (s) => ({ ...s, "7": [] }),
  },
];

export interface SourceHoraires {
  semaine?: Semaine | null;
  debut?: string | null;
  fin?: string | null;
}

export function aCreneauPonctuel(src: SourceHoraires): boolean {
  return lireHeure(src.debut) !== null || lireHeure(src.fin) !== null;
}

export function fenetresArret(src: SourceHoraires, ymd: string): Fenetres {
  const debut = lireHeure(src.debut);
  const fin = lireHeure(src.fin);

  if (debut !== null || fin !== null) {
    const d = debut ?? 0;
    const f = fin ?? 1440;
    return f > d ? [[d, f]] : null;
  }

  const creneaux = creneauxDuJour(
    src.semaine ? normaliserSemaine(src.semaine) : null,
    jourIso(ymd)
  );

  if (!creneaux) return null;
  return creneaux.map((c) => [
    lireHeure(c.open)!,
    lireHeure(c.close)!,
  ]);
}

export function libelleFenetres(
  f: Fenetres,
  ponctuel = false
): string | null {
  if (f === null) return null;
  if (!f.length) return "Fermé aujourd'hui";

  if (ponctuel) {
    const [d, e] = f[0]!;
    if (d <= 0) return `Avant ${afficherHeure(e)}`;
    if (e >= 1440) return `À partir de ${afficherHeure(d)}`;
    return `Créneau ${afficherHeure(d)}–${afficherHeure(e)}`;
  }

  return `Ouvert ${f
    .map(
      ([d, e]) =>
        `${afficherHeure(d)}–${e >= 1440 ? "24:00" : afficherHeure(e)}`
    )
    .join(" · ")}`;
}

export function resumeSemaine(semaine: Semaine): string {
  const texte = (j: Jour) => {
    const c = semaine[`${j}`];
    if (!c) return null;
    if (!c.length) return "fermé";
    return c
      .map(
        (x) =>
          `${afficherHeure(lireHeure(x.open)!)}–${afficherHeure(
            lireHeure(x.close)!
          )}`
      )
      .join(" · ");
  };

  const blocs: { jours: Jour[]; texte: string }[] = [];
  for (const { n } of JOURS) {
    const t = texte(n);
    if (t === null) continue;
    const der = blocs[blocs.length - 1];

    if (
      der &&
      der.texte === t &&
      der.jours[der.jours.length - 1] === n - 1
    ) {
      der.jours.push(n);
    } else {
      blocs.push({ jours: [n], texte: t });
    }
  }

  const nom = (j: Jour) => JOURS[j - 1]!.court;
  return blocs
    .map(
      (b) =>
        `${b.jours.length > 2 ? `${nom(b.jours[0]!)}–${nom(b.jours[b.jours.length - 1]!)}` : b.jours.map(nom).join(", ")} ${b.texte}`
    )
    .join(" · ");
}

export type StatutPassage = "libre" | "ok" | "hors" | "ferme";

export interface Passage {
  arrivee: number;
  debut: number;
  attente: number;
  statut: StatutPassage;
}

export function servir(
  t: number,
  f: Fenetres
): { debut: number; statut: StatutPassage; retard: number } {
  if (f === null) return { debut: t, statut: "libre", retard: 0 };
  if (!f.length) return { debut: t, statut: "ferme", retard: 0 };

  for (const [o, c] of f) {
    if (t < c) return { debut: Math.max(t, o), statut: "ok", retard: 0 };
  }

  return {
    debut: t,
    statut: "hors",
    retard: t - f[f.length - 1]![1],
  };
}

export interface ArretPlanifiable {
  point: Point | null;
  fenetres: Fenetres;
}

export function simulerPassages(
  depart: { point: Point | null; minute: number },
  arrets: ArretPlanifiable[],
  minutesParArret = MINUTES_PAR_ARRET
): { passages: Passage[]; fin: number; dernier: Point | null } {
  let t = depart.minute;
  let prec = depart.point;

  const passages = arrets.map((a) => {
    if (prec && a.point) t += minutesTrajet(distanceKm(prec, a.point));
    if (a.point) prec = a.point;

    const s = servir(t, a.fenetres);
    const p: Passage = {
      arrivee: t,
      debut: s.debut,
      attente: s.debut - t,
      statut: s.statut,
    };

    t = s.debut + minutesParArret;
    return p;
  });

  return { passages, fin: t, dernier: prec };
}

const PENALITE_HORS = 10_000;
const PENALITE_RETARD = 10;
const BUDGET_MS = 1500;

interface Probleme {
  debut: number;
  service: number;
  depuisDepart: number[];
  t: number[][];
  versFin: number[];
  fen: Fenetres[];
}

function evaluer(p: Probleme, ordre: number[]) {
  let t = p.debut;
  let prec = -1;
  let hors = 0;
  let retard = 0;

  for (const i of ordre) {
    t += prec < 0 ? p.depuisDepart[i]! : p.t[prec]![i]!;
    const s = servir(t, p.fen[i]!);

    if (s.statut === "hors") {
      hors++;
      retard += s.retard;
    }

    t = s.debut + p.service;
    prec = i;
  }

  if (prec >= 0) t += p.versFin[prec]!;
  return {
    hors,
    cout: hors * PENALITE_HORS + retard * PENALITE_RETARD + (t - p.debut),
  };
}

export function ordonnerAvecHoraires(
  depart: Point | null,
  arrets: { point: Point; fenetres: Fenetres }[],
  options: {
    debut: number;
    retour?: boolean;
    arrivee?: Point | null;
    minutesParArret?: number;
  }
): { ordre: number[]; fermes: number[]; impossibles: number[] } {
  const {
    debut,
    retour = true,
    arrivee = null,
    minutesParArret = MINUTES_PAR_ARRET,
  } = options;

  const n = arrets.length;
  const trajet = (a: Point | null, b: Point | null) =>
    a && b ? minutesTrajet(distanceKm(a, b)) : 0;

  const fermes: number[] = [];
  const impossibles: number[] = [];
  const reste: number[] = [];

  for (let i = 0; i < n; i++) {
    const f = arrets[i]!.fenetres;

    if (f && !f.length) {
      fermes.push(i);
    } else if (
      f &&
      debut + trajet(depart, arrets[i]!.point) >= f[f.length - 1]![1]
    ) {
      impossibles.push(i);
    } else {
      reste.push(i);
    }
  }

  const initial = optimiserOrdre(
    depart,
    reste.map((i) => arrets[i]!.point),
    retour,
    arrivee
  ).map((k) => reste[k]!);

  let ordre = initial;

  if (reste.some((i) => arrets[i]!.fenetres)) {
    const fin = arrivee ?? (retour ? depart : null);
    const p: Probleme = {
      debut,
      service: minutesParArret,
      depuisDepart: arrets.map((a) => trajet(depart, a.point)),
      t: arrets.map((a) => arrets.map((b) => trajet(a.point, b.point))),
      versFin: arrets.map((a) => trajet(a.point, fin)),
      fen: arrets.map((a) => a.fenetres),
    };

    ordre = ameliorer(p, initial, (i) => arrets[i]!.fenetres !== null);
  }

  return { ordre: [...ordre, ...impossibles, ...fermes], fermes, impossibles };
}

function ameliorer(
  p: Probleme,
  initial: number[],
  aHoraires: (i: number) => boolean
): number[] {
  const t0 = Date.now();
  let ordre = [...initial];
  let actuel = evaluer(p, ordre);

  const essayer = (candidat: number[]) => {
    const e = evaluer(p, candidat);
    if (e.hors <= actuel.hors && e.cout + 1e-6 < actuel.cout) {
      ordre = candidat;
      actuel = e;
      return true;
    }
    return false;
  };

  const deplacer = (filtre: (i: number) => boolean) => {
    let mieux = false;

    for (const x of [...ordre]) {
      if (!filtre(x)) continue;
      const sans = ordre.filter((y) => y !== x);
      let meilleur: number[] | null = null;
      let meilleurCout = actuel.cout;
      let meilleurHors = actuel.hors;

      for (let pos = 0; pos <= sans.length; pos++) {
        const c = [...sans.slice(0, pos), x, ...sans.slice(pos)];
        const e = evaluer(p, c);

        if (e.hors <= meilleurHors && e.cout + 1e-6 < meilleurCout) {
          meilleur = c;
          meilleurCout = e.cout;
          meilleurHors = e.hors;
        }
      }

      if (meilleur) {
        ordre = meilleur;
        actuel = { hors: meilleurHors, cout: meilleurCout };
        mieux = true;
      }
    }

    return mieux;
  };

  for (let passe = 0; passe < 5 && deplacer(aHoraires); passe++) {
    if (Date.now() - t0 > BUDGET_MS) return ordre;
  }

  for (let passe = 0; passe < 20; passe++) {
    let mieux = deplacer(() => true);

    for (let i = 0; i < ordre.length - 1; i++) {
      for (let k = i + 1; k < ordre.length; k++) {
        if (
          essayer([
            ...ordre.slice(0, i),
            ...ordre.slice(i, k + 1).reverse(),
            ...ordre.slice(k + 1),
          ])
        ) {
          mieux = true;
        }
      }

      if (Date.now() - t0 > BUDGET_MS) return ordre;
    }

    if (!mieux) break;
  }

  return ordre;
}

export function heureDepart(
  run: { status: string; run_date: string; planned_start?: string | null },
  maintenant: Date,
  enRoute = run.status === "in_progress"
): { jour: string; minute: number } {
  const today = dateParis(maintenant);
  const now = minutesParis(maintenant);

  if (enRoute || run.run_date < today) return { jour: today, minute: now };

  const prevu = lireHeure(run.planned_start) ?? DEPART_PAR_DEFAUT;
  return {
    jour: run.run_date,
    minute: run.run_date === today ? Math.max(prevu, now) : prevu,
  };
}

export function passagesTournee(
  arrets: {
    id: string;
    status: string;
    lat: number | string | null;
    lng: number | string | null;
    fenetres: Fenetres;
  }[],
  depart: { point: Point | null; minute: number }
): Map<string, Passage> {
  const restants = arrets.filter((a) => a.status === "pending");
  const { passages } = simulerPassages(
    depart,
    restants.map((a) => ({
      point:
        a.lat === null || a.lng === null
          ? null
          : { lat: Number(a.lat), lng: Number(a.lng) },
      fenetres: a.fenetres,
    }))
  );

  return new Map(restants.map((a, i) => [a.id, passages[i]!]));
}
