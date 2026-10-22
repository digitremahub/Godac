/**
 * Carte grise (certificat d'immatriculation) → champs utiles à la TICPE.
 * Pur, testé. La lecture (OCR) est dans lib/ocr/carte-grise.ts ; rien
 * n'est enregistré sans confirmation par une personne.
 *
 * Cases lues : A (immatriculation), B (date de 1re immatriculation),
 * D.1 (marque), J.1 (genre national), F.2 (PTAC en kg), P.3 (énergie).
 */

import type { VehicleType } from "@/lib/types/domain";

export interface LectureCarteGrise {
  immatriculation: string | null;
  date_premiere_immat: string | null;
  marque: string | null;
  genre: string | null;
  ptac_kg: number | null;
  energie: string | null;
}

export const LIBELLES_ENERGIE_P3: Record<string, string> = {
  GO: "Gazole",
  ES: "Essence",
  EL: "Électrique",
  GN: "GNV",
  GP: "GPL",
  FE: "Superéthanol E85",
  H2: "Hydrogène",
  EH: "Hybride essence",
  EE: "Hybride rechargeable essence",
  GH: "Hybride gazole",
  GL: "Hybride rechargeable gazole",
};

/** Genres J.1 de véhicules lourds (camion, tracteur routier, autocar/autobus). */
const GENRES_LOURDS = ["CAM", "TRR", "TCP", "VASP"];

export interface PropositionVehicule {
  registration: string | null;
  type: VehicleType | null;
  ptac_kg: number | null;
  fuel_type: string | null;
  cg_genre: string | null;
  cg_energie: string | null;
  cg_premiere_immat: string | null;
  brand: string | null;
}

/** Normalise une immatriculation (AB-123-CD) ; renvoie la saisie nettoyée sinon. */
export function normaliserImmatriculation(brut: string | null | undefined): string | null {
  if (!brut) return null;
  const s = brut.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const siv = /^([A-Z]{2})(\d{3})([A-Z]{2})$/.exec(s);
  if (siv) return `${siv[1]}-${siv[2]}-${siv[3]}`;
  return s || null;
}

/** JJ/MM/AAAA, AAAA-MM-JJ → AAAA-MM-JJ (date réelle) ; sinon null. */
export function normaliserDate(brut: string | null | undefined): string | null {
  if (!brut) return null;
  const t = brut.trim();
  let y: number, m: number, d: number;
  const fr = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (fr) [d, m, y] = [Number(fr[1]), Number(fr[2]), Number(fr[3])];
  else if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || y < 1950 || y > 2100) return null;
  return dt.toISOString().slice(0, 10);
}

/**
 * Type GODAC proposé : genre lourd (CAM, TCP, VASP) de plus de 3,5 t → PL,
 * tracteur routier (TRR) → SPL, genre léger (VP, CTTE…) → VL. Sans genre,
 * le PTAC seul décide (> 3,5 t → PL). La personne confirme.
 */
export function typePropose(genre: string | null, ptacKg: number | null): VehicleType | null {
  const g = (genre ?? "").trim().toUpperCase();
  if (g === "TRR") return "SPL";
  if (GENRES_LOURDS.includes(g)) return ptacKg !== null && ptacKg <= 3500 ? "VL" : "PL";
  if (g) return "VL";
  if (ptacKg === null) return null;
  return ptacKg > 3500 ? "PL" : "VL";
}

export function propositionDepuisCarteGrise(l: LectureCarteGrise): PropositionVehicule {
  const ptac = l.ptac_kg !== null && Number.isFinite(l.ptac_kg) && l.ptac_kg > 0 && l.ptac_kg < 100000 ? Math.round(l.ptac_kg) : null;
  const energie = l.energie ? l.energie.trim().toUpperCase().slice(0, 4) : null;
  const genre = l.genre ? l.genre.trim().toUpperCase().slice(0, 12) : null;
  return {
    registration: normaliserImmatriculation(l.immatriculation),
    type: typePropose(genre, ptac),
    ptac_kg: ptac,
    fuel_type: energie ? (LIBELLES_ENERGIE_P3[energie] ?? energie) : null,
    cg_genre: genre,
    cg_energie: energie,
    cg_premiere_immat: normaliserDate(l.date_premiere_immat),
    brand: l.marque?.trim() || null,
  };
}

/** Différences entre la fiche et la carte grise, pour les montrer avant confirmation. */
export function differencesFiche(
  fiche: { registration?: string | null; type?: string | null; ptac_kg?: number | string | null; fuel_type?: string | null },
  p: PropositionVehicule,
): string[] {
  const diffs: string[] = [];
  if (p.registration && fiche.registration && normaliserImmatriculation(fiche.registration) !== p.registration) diffs.push(`Immatriculation : fiche ${fiche.registration}, carte grise ${p.registration}`);
  if (p.type && fiche.type && fiche.type !== p.type) diffs.push(`Type : fiche ${fiche.type}, carte grise ${p.type}`);
  const ptacFiche = fiche.ptac_kg === null || fiche.ptac_kg === undefined || fiche.ptac_kg === "" ? null : Number(fiche.ptac_kg);
  if (p.ptac_kg !== null && ptacFiche !== null && ptacFiche !== p.ptac_kg) diffs.push(`PTAC : fiche ${ptacFiche} kg, carte grise ${p.ptac_kg} kg`);
  return diffs;
}
