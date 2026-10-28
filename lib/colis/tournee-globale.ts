/**
 * Optimisation globale d'une tournée à plusieurs villages : toutes les
 * listes (une par village, plus « Hors tournée ») s'enchaînent dans un
 * seul sens de tournée.
 *
 * 1. Ordre des villages : chaque village est représenté par son arrêt
 *    « central » (médoïde) ; on résout le voyageur de commerce sur ces
 *    représentants depuis le dépôt (optimiserOrdre), puis on compare cet
 *    ordre, son inverse et l'ordre actuel en calculant la tournée complète
 *    (sequenceParListes : chaque village optimisé à son tour, en partant du
 *    dernier arrêt du village précédent), et on améliore par déplacements
 *    d'un village (Or-opt) tant que le budget de calcul le permet.
 * 2. Ordre dans chaque village : sequenceParListes, avec les horaires des
 *    adresses pro (lib/colis/horaires.ts) lors du calcul final.
 *
 * Les listes hors tournée (une par commune, hors des villages de la tournée)
 * passent après les villages, mais restent groupées par commune : elles
 * s'enchaînent de proche en proche depuis le dernier village. La liste
 * « Reportés » (villages décochés au lancement) reste en dernier, hors calcul.
 *
 * Extrémités (premier / dernier arrêt, point d'arrivée : lib/colis/extremites.ts) :
 * la liste du premier arrêt ouvre la tournée, celle du dernier la ferme,
 * seuls les villages du milieu sont ordonnés entre les deux.
 *
 * Sens habituel (lib/colis/sens-tournee.ts) : si `sens.reference` (ordre habituel
 * des secteurs, par clé de nom de liste) est fourni, il sert de biais DOUX : l'ordre
 * habituel devient un candidat et les comparaisons (candidats, Or-opt) portent sur
 * km × (1 + λ × désordre), λ ≤ 10 %. À longueur égale l'ordre habituel gagne ; un
 * ordre habituel nettement plus long n'est jamais retenu. Sans `sens`, le calcul est
 * strictement celui d'avant.
 *
 * Les distances viennent de la matrice routière (km réels) fournie par
 * l'appelant ; repli géographique sinon. Purement fonctionnel (testé dans
 * lib/colis/__tests__/tournee-globale.test.ts).
 */
import { distanceEstimee, memePoint, optimiserOrdre, plusProcheVoisin, type Point } from "@/lib/colis/optimisation";
import { estListeHorsTournee, estListeReportee } from "@/lib/colis/villages";
import { sequenceParListes, type ArretOptimisable, type ExtremitesSequence, type Liste } from "@/lib/colis/listes";
import { cleSecteur, coutBiaise, desordre as desordreSens, lambdaBorne, ordonnerSelonReference } from "@/lib/colis/sens-tournee";

/** Garde-fou (ms) de la recherche locale sur l'ordre des villages. */
const BUDGET_MS = 1200;

const pointDe = (s: ArretOptimisable): Point | null => (s.lat === null || s.lng === null ? null : { lat: Number(s.lat), lng: Number(s.lng) });

/** Arrêt le plus « central » d'un groupe : somme des distances aux autres minimale. */
export function medoide(points: Point[], distance: (a: Point, b: Point) => number = distanceEstimee): Point | null {
  if (!points.length) return null;
  if (points.length <= 2) return points[0]!;
  let meilleur = points[0]!;
  let cout = Infinity;
  for (const p of points) {
    let c = 0;
    for (const q of points) if (p !== q) c += distance(p, q);
    if (c < cout) {
      cout = c;
      meilleur = p;
    }
  }
  return meilleur;
}

/** Sens habituel à privilégier (biais doux). */
export interface SensPrefere {
  /** Clés de secteur (cleSecteur du nom de la liste) dans l'ordre à privilégier. */
  reference: string[];
  /** Poids du biais (défaut LAMBDA_SENS, borné à LAMBDA_MAX). */
  lambda?: number;
}

export interface OrdreGlobal {
  /** Listes dans l'ordre retenu, positions renumérotées 0, 1, 2… */
  listes: Liste[];
  /** Avec un sens préféré : désordre (0 à 1) de l'ordre retenu par rapport à lui ; 0 = ordre habituel suivi. */
  desordreSens?: number;
  /** Km (routiers si matrice) de la tournée complète avec cet ordre, sans horaires. */
  km: number;
  /** Km avec l'ordre des listes d'origine (pour comparaison). */
  kmOrdreActuel: number;
}

/**
 * Ordre global des listes (villages) d'une tournée. Les listes sans arrêt
 * restant localisé gardent leur ordre relatif, après les autres. La liste
 * implicite (arrêts sans liste) reste toujours en tête (grouperParListe).
 */
export function ordonnerListesGlobalement(
  arrets: ArretOptimisable[],
  listes: Liste[],
  depart: Point | null,
  retour: boolean,
  distance: (a: Point, b: Point) => number = distanceEstimee,
  extremites?: ExtremitesSequence,
  sens?: SensPrefere,
): OrdreGlobal {
  const triees = [...listes].sort((a, b) => a.position - b.position);
  const reportees = new Set(triees.filter(estListeReportee).map((l) => l.id));
  const pendants = arrets.filter((s) => s.status === "pending" && pointDe(s) && !(s.list_id && reportees.has(s.list_id)));
  const parListe = new Map<string, Point[]>();
  for (const s of pendants) if (s.list_id) parListe.set(s.list_id, [...(parListe.get(s.list_id) ?? []), pointDe(s)!]);
  const actives = triees.filter((l) => parListe.has(l.id));
  const vides = [...triees.filter((l) => !parListe.has(l.id) && !reportees.has(l.id)), ...triees.filter((l) => reportees.has(l.id))];
  const kmActuel = sequenceParListes(arrets, triees, depart, retour, undefined, distance, extremites).kmApres;
  if (actives.length <= 1) return { listes: [...actives, ...vides].map((l, i) => ({ ...l, position: i })), km: kmActuel, kmOrdreActuel: kmActuel };

  // Listes imposées en tête / en queue par le premier et le dernier arrêt.
  const listeDe = (id: string | null | undefined) => (id ? (arrets.find((s) => s.id === id)?.list_id ?? null) : null);
  const premiere = actives.find((l) => l.id === listeDe(extremites?.premierId)) ?? null;
  const derniere = actives.find((l) => l.id === listeDe(extremites?.dernierId) && l !== premiere) ?? null;
  const milieu = actives.filter((l) => l !== premiere && l !== derniere);
  const milieuH = milieu.filter(estListeHorsTournee);
  const villages = milieu.filter((l) => !estListeHorsTournee(l));
  const centre = (l: Liste | null | undefined) => (l ? medoide(parListe.get(l.id)!, distance) : null);
  const representantsH = milieuH.map((l) => centre(l)!);
  // Communes hors tournée : de proche en proche depuis le dernier village (ou le départ).
  const ordreHors = (apresVillages: Liste[]) =>
    milieuH.length <= 1 ? milieuH : plusProcheVoisin(centre(apresVillages[apresVillages.length - 1]) ?? centre(premiere) ?? depart, representantsH, distance).map((k) => milieuH[k]!);
  const assembler = (ordre: Liste[]) => [...(premiere ? [premiere] : []), ...ordre, ...ordreHors(ordre), ...(derniere ? [derniere] : [])];

  // Évaluation avec la distance de l'appelant (matrice routière).
  const kmDe = (ordre: Liste[]) =>
    sequenceParListes(
      arrets,
      [...assembler(ordre), ...vides].map((l, i) => ({ ...l, position: i })),
      depart,
      retour,
      undefined,
      distance,
      extremites,
    ).kmApres;

  const reference = sens && sens.reference.length >= 2 ? sens.reference : null;
  const lambda = lambdaBorne(sens?.lambda);
  const cleDe = (l: Liste) => cleSecteur(l.name);
  const desordreDe = (ordre: Liste[]) => (reference ? desordreSens(assembler(ordre).map(cleDe), reference) : 0);
  const coutDe = (ordre: Liste[], km = kmDe(ordre)) => coutBiaise(km, desordreDe(ordre), lambda);

  if (villages.length <= 1) {
    const ordre = assembler(villages);
    return { listes: [...ordre, ...vides].map((l, i) => ({ ...l, position: i })), km: kmDe(villages), kmOrdreActuel: kmActuel, ...(reference ? { desordreSens: desordreDe(villages) } : {}) };
  }

  const representants = villages.map((l) => medoide(parListe.get(l.id)!, distance)!);
  const fin = extremites?.fin !== undefined ? extremites.fin : retour ? depart : null;
  const debutTsp = premiere ? medoide(parListe.get(premiere.id)!, distance) : depart;
  const finTsp = derniere ? medoide(parListe.get(derniere.id)!, distance) : fin;
  const boucle = !premiere && !derniere && memePoint(fin, depart);
  const proche = extremites?.strategie === "proche";
  const tsp = (proche ? plusProcheVoisin(debutTsp, representants, distance) : optimiserOrdre(debutTsp, representants, boucle, boucle ? null : finTsp, distance)).map((k) => villages[k]!);
  const candidats = proche ? [tsp] : [tsp, [...tsp].reverse(), villages];
  // Ordre habituel : un candidat de plus (les villages nouveaux s'insèrent là où ils coûtent le moins).
  if (reference) candidats.push(ordonnerSelonReference(villages, cleDe, reference, kmDe));
  let meilleur = candidats[0]!;
  let meilleurCout = Infinity;
  for (const c of candidats) {
    const cout = coutDe(c);
    if (cout + 1e-9 < meilleurCout) {
      meilleur = c;
      meilleurCout = cout;
    }
  }

  // Or-opt sur l'ordre des villages : déplacer un village ailleurs s'il raccourcit la tournée.
  const t0 = Date.now();
  let ameliore = true;
  while (!proche && ameliore && Date.now() - t0 < BUDGET_MS) {
    ameliore = false;
    for (let i = 0; i < meilleur.length && !ameliore; i++) {
      const sans = [...meilleur.slice(0, i), ...meilleur.slice(i + 1)];
      for (let p = 0; p <= sans.length; p++) {
        if (p === i) continue;
        const essai = [...sans.slice(0, p), meilleur[i]!, ...sans.slice(p)];
        const cout = coutDe(essai);
        if (cout + 1e-6 < meilleurCout) {
          meilleur = essai;
          meilleurCout = cout;
          ameliore = true;
          break;
        }
        if (Date.now() - t0 > BUDGET_MS) break;
      }
    }
  }

  return {
    listes: [...assembler(meilleur), ...vides].map((l, i) => ({ ...l, position: i })),
    km: kmDe(meilleur),
    kmOrdreActuel: kmDe(villages),
    ...(reference ? { desordreSens: desordreDe(meilleur) } : {}),
  };
}
