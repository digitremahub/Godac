/**
 * Démo — données TICPE de « Transports Démo », sans accès à la base
 * (testées dans lib/demo/__tests__/donnees-ticpe.test.ts). Tout est
 * fictif : immatriculations du seed (lib/demo/seed.ts), stations et
 * références de relevés inventées. lib/demo/seed-ticpe.ts écrit ces
 * lignes dans les vraies tables.
 */

/** Taux 2025-2026 métropole, en €/L (15,56 €/hl) — sert seulement aux montants des déclarations passées. */
export const TAUX_DEMO_EUR_L = 0.1556;

export interface FicheTicpeDemo {
  ptac_kg: number | null;
  cg_genre: string | null;
  cg_energie: string | null;
  cg_premiere_immat: string | null;
  /** Carte grise jointe et confirmée par la direction. */
  carteGrise: boolean;
}

/**
 * Fiche TICPE de chaque véhicule de la démo : cinq poids lourds éligibles,
 * un poids lourd « à vérifier » (PTAC inconnu, pas de carte grise) et deux
 * utilitaires légers, jamais éligibles.
 */
export const FICHES_TICPE_DEMO: Record<string, FicheTicpeDemo> = {
  "FH-123-AB": { ptac_kg: 19000, cg_genre: "CAM", cg_energie: "GO", cg_premiere_immat: "2021-03-15", carteGrise: true },
  "GK-456-CD": { ptac_kg: 12000, cg_genre: "CAM", cg_energie: "GO", cg_premiere_immat: "2022-06-02", carteGrise: true },
  "HZ-789-EF": { ptac_kg: 16000, cg_genre: "CAM", cg_energie: "GO", cg_premiere_immat: "2024-02-20", carteGrise: true },
  "JL-321-GH": { ptac_kg: 19000, cg_genre: "TRR", cg_energie: "GO", cg_premiere_immat: "2020-09-10", carteGrise: true },
  "KM-654-IJ": { ptac_kg: null, cg_genre: null, cg_energie: null, cg_premiere_immat: null, carteGrise: false },
  "LN-987-KL": { ptac_kg: 12000, cg_genre: "CAM", cg_energie: "GO", cg_premiere_immat: "2023-05-11", carteGrise: true },
  "MP-147-MN": { ptac_kg: 3500, cg_genre: "CTTE", cg_energie: "GO", cg_premiere_immat: "2022-11-08", carteGrise: true },
  "NQ-258-OP": { ptac_kg: 3500, cg_genre: "CTTE", cg_energie: "GO", cg_premiere_immat: "2021-01-27", carteGrise: true },
};

/** Véhicules dont les pleins en station sont générés (poids lourds, y compris celui « à vérifier »). */
export interface CamionDemo {
  registration: string;
  /** Capacité du réservoir : un plein ne la dépasse jamais (sinon contrôle « plus de litres que le réservoir »). */
  reservoir: number;
}

export interface PleinStationDemo {
  registration: string;
  /** Jour calendaire (AAAA-MM-JJ) et heure locale (HH:MM). */
  jour: string;
  heure: string;
  liters: number;
  unit_price: number;
  station_name: string;
  ticpe_justificatif: "releve_carte" | "facture" | null;
  ticpe_justificatif_ref: string | null;
}

const STATIONS = ["Relais PL de la Vallée (fictif)", "Station Carte Pro Rhône Sud (fictive)", "Aire poids lourds des Collines (fictive)"];

const pad = (n: number) => String(n).padStart(2, "0");

/** « AAAA-MM » du mois qui précède ou suit `mois` de `n` mois. */
export function decalerMois(mois: string, n: number): string {
  const [y, m] = mois.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

/** Mois (AAAA-MM) de janvier 2025 jusqu'au mois précédant `today`, inclus. */
export function moisHistorique(today: string): string[] {
  const dernier = decalerMois(today.slice(0, 7), -1);
  const mois: string[] = [];
  for (let m = "2025-01"; m <= dernier; m = decalerMois(m, 1)) mois.push(m);
  return mois;
}

/** PRNG déterministe : une remise à zéro produit toujours les mêmes données. */
function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * Pleins en station de janvier 2025 au mois dernier : trois par mois et
 * par camion, chacun avec un justificatif (relevé de carte carburant, ou
 * facture une fois sur six). Le mois dernier — la période à déclarer —
 * reçoit en plus deux cas que les contrôles doivent signaler : un plein
 * sans justificatif et un doublon probable (même plein saisi deux fois).
 */
export function pleinsStationDemo(today: string, camions: readonly CamionDemo[]): PleinStationDemo[] {
  const rand = prng(20261031);
  const pleins: PleinStationDemo[] = [];
  const mois = moisHistorique(today);
  for (const m of mois) {
    const prixBase = m < "2026-01" ? 1.62 : 1.66;
    camions.forEach((c, ic) => {
      [5, 14, 23].forEach((jourBase, k) => {
        const jour = `${m}-${pad(jourBase + Math.floor(rand() * 4))}`;
        const liters = Math.round(c.reservoir * (0.62 + rand() * 0.3) * 10) / 10;
        const facture = (ic + k) % 6 === 0;
        pleins.push({
          registration: c.registration,
          jour,
          heure: `${pad(15 + Math.floor(rand() * 4))}:${pad(Math.floor(rand() * 60))}`,
          liters,
          unit_price: Math.round((prixBase + rand() * 0.08) * 1000) / 1000,
          station_name: STATIONS[(ic + k) % STATIONS.length]!,
          ticpe_justificatif: facture ? "facture" : "releve_carte",
          ticpe_justificatif_ref: `${facture ? "FAC" : "RC"}-${m.replace("-", "")}-${pad(ic + 1)}${k + 1}`,
        });
      });
    });
  }

  const dernier = mois[mois.length - 1];
  if (dernier && camions.length >= 2) {
    const a = camions[1]!;
    const b = camions[0]!;
    // Plein sans justificatif : ni ticket, ni relevé, ni facture.
    pleins.push({ registration: a.registration, jour: `${dernier}-27`, heure: "07:40", liters: Math.round(a.reservoir * 0.7 * 10) / 10, unit_price: 1.689, station_name: STATIONS[0]!, ticpe_justificatif: null, ticpe_justificatif_ref: null });
    // Doublon probable : le même plein saisi depuis le relevé de carte puis depuis la facture, 10 minutes d'écart.
    const litres = Math.round(b.reservoir * 0.8 * 10) / 10;
    pleins.push({ registration: b.registration, jour: `${dernier}-28`, heure: "16:05", liters: litres, unit_price: 1.672, station_name: STATIONS[1]!, ticpe_justificatif: "releve_carte", ticpe_justificatif_ref: `RC-${dernier.replace("-", "")}-D1` });
    pleins.push({ registration: b.registration, jour: `${dernier}-28`, heure: "16:15", liters: litres, unit_price: 1.672, station_name: STATIONS[1]!, ticpe_justificatif: "facture", ticpe_justificatif_ref: `FAC-${dernier.replace("-", "")}-D1` });
  }
  return pleins.sort((x, y) => `${x.jour}${x.heure}`.localeCompare(`${y.jour}${y.heure}`));
}

export interface DeclarationDemo {
  periode_cle: string;
  periode_libelle: string;
  periode_debut: string;
  periode_fin: string;
  declaree_le: string;
  litres: number;
  montant: number;
}

const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** Mois de 2025 volontairement « oubliés » : ils apparaissent en argent non réclamé. */
export const MOIS_NON_DECLARES_DEMO = ["2025-03", "2025-04"];

/**
 * Déclarations mensuelles déjà faites (régime de TVA mensuel) : tous les
 * mois jusqu'à l'avant-dernier, sauf deux mois de 2025 oubliés. Le mois
 * dernier reste à déclarer. Seuls les pleins des véhicules `eligibles`,
 * hors doublon et sans justificatif manquant, sont comptés.
 */
export function declarationsDemo(today: string, pleins: readonly PleinStationDemo[], eligibles: ReadonlySet<string>): DeclarationDemo[] {
  const mois = moisHistorique(today).slice(0, -1).filter((m) => !MOIS_NON_DECLARES_DEMO.includes(m));
  return mois.map((m) => {
    const litres = Math.round(
      pleins
        .filter((p) => p.jour.startsWith(m) && eligibles.has(p.registration) && p.ticpe_justificatif !== null)
        .reduce((s, p) => s + p.liters, 0) * 100,
    ) / 100;
    const [y, mm] = m.split("-").map(Number) as [number, number];
    const fin = new Date(Date.UTC(y, mm, 0)).getUTCDate();
    return {
      periode_cle: m,
      periode_libelle: `${MOIS_FR[mm - 1]} ${y}`,
      periode_debut: `${m}-01`,
      periode_fin: `${m}-${pad(fin)}`,
      declaree_le: `${decalerMois(m, 1)}-17`,
      litres,
      montant: Math.round(litres * TAUX_DEMO_EUR_L * 100) / 100,
    };
  });
}

/**
 * Un PDF d'une page, valide et minimal, portant quelques lignes de texte
 * (ASCII) : remplace la carte grise et la facture de cuve, pour que les
 * documents de la démo s'ouvrent au lieu d'afficher une erreur.
 */
export function pdfFictif(lignes: readonly string[]): Uint8Array {
  const echapper = (t: string) => t.replace(/[^\x20-\x7E]/g, "?").replace(/([\\()])/g, "\\$1");
  const contenu = ["BT", "/F1 14 Tf", "60 780 Td", "18 TL", ...lignes.map((l) => `(${echapper(l)}) '`), "ET"].join("\n");
  const objets = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${contenu.length} >>\nstream\n${contenu}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const positions: number[] = [];
  objets.forEach((o, i) => {
    positions.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n${positions.map((p) => `${String(p).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
