// Journal de paie mensuel : une ligne par bulletin calculé, ventilée par
// rubrique du bulletin clarifié, et les totaux de l'entreprise. Fichier
// pur (écran, PDF, export comptable), testé dans
// lib/paie/__tests__/journal.test.ts.

import type { Bulletin, Section } from "@/lib/paie/types";
import { LIBELLES_VALIDATION, statutValide, type StatutValidation } from "@/lib/paie/validation";

/** Rubriques de cotisations, dans l'ordre du bulletin clarifié. */
export const RUBRIQUES = [
  { id: "sante", libelle: "Santé" },
  { id: "at", libelle: "AT/MP" },
  { id: "retraite", libelle: "Retraite" },
  { id: "famille", libelle: "Famille" },
  { id: "chomage", libelle: "Chômage" },
  { id: "autres", libelle: "Autres" },
  { id: "csg", libelle: "CSG/CRDS" },
  { id: "exonerations", libelle: "Exonérations" },
] as const satisfies readonly { id: Section; libelle: string }[];
export type RubriqueId = (typeof RUBRIQUES)[number]["id"];

export interface Part {
  salarial: number;
  patronal: number;
}
export type Ventilation = Record<RubriqueId, Part>;

const r2 = (n: number) => Math.round(n * 100) / 100;

const vide = (): Ventilation => Object.fromEntries(RUBRIQUES.map((r) => [r.id, { salarial: 0, patronal: 0 }])) as Ventilation;

/**
 * Cotisations d'un bulletin par rubrique. Les lignes de gain (brut,
 * indemnités de frais) sont exclues ; la rubrique « exonérations » porte
 * la réduction salariale HS (négative), la déduction patronale HS et la
 * réduction générale (négatives).
 */
export function ventiler(b: Pick<Bulletin, "lignes">): Ventilation {
  const v = vide();
  for (const l of b.lignes ?? []) {
    if (l.gain || !(l.section in v)) continue;
    const p = v[l.section as RubriqueId];
    p.salarial += l.montantSalarial ?? 0;
    p.patronal += l.montantPatronal ?? 0;
  }
  for (const r of RUBRIQUES) v[r.id] = { salarial: r2(v[r.id].salarial), patronal: r2(v[r.id].patronal) };
  return v;
}

/** Indemnités de frais et primes non soumises (lignes de gain de la rubrique « net »). */
export function fraisDuBulletin(b: Pick<Bulletin, "lignes">): number {
  return r2((b.lignes ?? []).filter((l) => l.section === "net" && l.gain).reduce((t, l) => t + (l.montantSalarial ?? 0), 0));
}

export interface LigneJournal {
  userId: string;
  nom: string;
  matricule: string | null;
  statut: StatutValidation;
  brut: number;
  rubriques: Ventilation;
  totalSalarial: number;
  totalPatronal: number;
  reductionGenerale: number;
  netSocial: number;
  netImposable: number;
  montantPas: number;
  frais: number;
  retenues: number;
  netPaye: number;
  /** Coût total employeur : brut + cotisations patronales + frais. */
  coutTotal: number;
}

export function ligneJournal(
  salarie: { id: string; nom: string; matricule?: string | null },
  bulletin: { validation_status?: string | null; details: Bulletin },
): LigneJournal {
  const d = bulletin.details;
  return {
    userId: salarie.id,
    nom: salarie.nom,
    matricule: salarie.matricule ?? null,
    statut: statutValide(bulletin.validation_status),
    brut: d.brut,
    rubriques: ventiler(d),
    totalSalarial: d.totalSalarial,
    totalPatronal: d.totalPatronal,
    reductionGenerale: d.reductionGenerale ?? 0,
    netSocial: d.netSocial,
    netImposable: d.netImposable,
    montantPas: d.montantPas,
    frais: fraisDuBulletin(d),
    retenues: d.totalRetenues ?? 0,
    netPaye: d.netAPayer,
    coutTotal: d.coutEmployeur,
  };
}

export type TotauxJournal = Omit<LigneJournal, "userId" | "nom" | "matricule" | "statut"> & { effectif: number; nonValides: number };

/** Totaux de l'entreprise (au centime). */
export function totauxJournal(lignes: readonly LigneJournal[]): TotauxJournal {
  const somme = (f: (l: LigneJournal) => number) => r2(lignes.reduce((t, l) => t + f(l), 0));
  const rubriques = vide();
  for (const r of RUBRIQUES) rubriques[r.id] = { salarial: somme((l) => l.rubriques[r.id].salarial), patronal: somme((l) => l.rubriques[r.id].patronal) };
  return {
    effectif: lignes.length,
    nonValides: lignes.filter((l) => l.statut !== "valide").length,
    brut: somme((l) => l.brut),
    rubriques,
    totalSalarial: somme((l) => l.totalSalarial),
    totalPatronal: somme((l) => l.totalPatronal),
    reductionGenerale: somme((l) => l.reductionGenerale),
    netSocial: somme((l) => l.netSocial),
    netImposable: somme((l) => l.netImposable),
    montantPas: somme((l) => l.montantPas),
    frais: somme((l) => l.frais),
    retenues: somme((l) => l.retenues),
    netPaye: somme((l) => l.netPaye),
    coutTotal: somme((l) => l.coutTotal),
  };
}

export function libelleStatut(s: StatutValidation): string {
  return LIBELLES_VALIDATION[s];
}
