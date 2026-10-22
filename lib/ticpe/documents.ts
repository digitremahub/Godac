/**
 * Données des documents TICPE — pur, testé :
 *  - récapitulatif de période pour l'annexe 3310-TIC (volumes en hl et
 *    montant par activité, zone et taux ; détail par véhicule) ;
 *  - état récapitulatif annuel (ERA, décret n° 2025-255 du 19/03/2025) :
 *    par véhicule, quantités acquises, informations du véhicule, montant,
 *    détail par usage (activité), produit et zone.
 */

import { LIBELLES_CATEGORIE_COURTS, LIBELLES_ZONE, type CategorieTicpe, type ZoneTicpe } from "@/lib/ticpe/bareme";
import type { ResultatEligibilite } from "@/lib/ticpe/eligibilite";
import { lignesDeLaPeriode, totaliser, type LigneTicpe } from "@/lib/ticpe/montant";
import { parVehicule, recapitulatif3310, type LigneRecap } from "@/lib/ticpe/synthese";

export interface InfosVehiculeDoc {
  registration: string;
  type: string;
  ptac_kg?: number | string | null;
  fuel_type?: string | null;
  cg_genre?: string | null;
  cg_energie?: string | null;
  cg_premiere_immat?: string | null;
  ownership?: string | null;
  eligibilite: ResultatEligibilite;
}

export interface LigneVehiculeDoc {
  vehicleId: string;
  registration: string;
  type: string;
  categorie: string;
  ptacKg: number | null;
  pleins: number;
  litres: number;
  litresRetenus: number;
  litresHorsPlafond: number;
  montant: number;
  tauxManquants: number;
}

function ptac(v: InfosVehiculeDoc | undefined): number | null {
  if (!v || v.ptac_kg === null || v.ptac_kg === undefined || v.ptac_kg === "") return null;
  const n = Number(v.ptac_kg);
  return Number.isFinite(n) ? n : null;
}

export function lignesVehicules(lignes: readonly LigneTicpe[], vehicules: ReadonlyMap<string, InfosVehiculeDoc>): LigneVehiculeDoc[] {
  return [...parVehicule(lignes).entries()]
    .map(([id, t]) => {
      const v = vehicules.get(id);
      const cat = v?.eligibilite.categorie;
      return {
        vehicleId: id,
        registration: v?.registration ?? "—",
        type: v?.type ?? "—",
        categorie: cat ? LIBELLES_CATEGORIE_COURTS[cat] : "—",
        ptacKg: ptac(v),
        pleins: t.pleins,
        litres: t.litres,
        litresRetenus: t.litresRetenus,
        litresHorsPlafond: t.litresHorsPlafond,
        montant: t.montant,
        tauxManquants: t.tauxManquants,
      };
    })
    .sort((a, b) => a.registration.localeCompare(b.registration, "fr"));
}

export interface DocumentPeriode {
  debut: string;
  fin: string;
  recap: LigneRecap[];
  vehicules: LigneVehiculeDoc[];
  totalLitres: number;
  totalLitresRetenus: number;
  totalHectolitres: number;
  totalMontant: number;
  tauxManquants: number;
}

export function documentPeriode(lignes: readonly LigneTicpe[], vehicules: ReadonlyMap<string, InfosVehiculeDoc>, debut: string, fin: string): DocumentPeriode {
  const l = lignesDeLaPeriode(lignes, debut, fin);
  const t = totaliser(l);
  return {
    debut,
    fin,
    recap: recapitulatif3310(l),
    vehicules: lignesVehicules(l, vehicules),
    totalLitres: t.litres,
    totalLitresRetenus: t.litresRetenus,
    totalHectolitres: Math.round(t.litresRetenus) / 100,
    totalMontant: t.montant,
    tauxManquants: t.tauxManquants,
  };
}

export interface DetailEra {
  usage: string;
  produit: string;
  zone: string;
  taux: number | null;
  litres: number;
  montant: number;
}

export interface LigneEra {
  vehicleId: string;
  registration: string;
  type: string;
  genre: string | null;
  ptacKg: number | null;
  energie: string | null;
  premiereImmat: string | null;
  detention: string;
  categorie: string;
  periodeDebut: string | null;
  periodeFin: string | null;
  /** Quantités de gazole acquises (pleins validés du véhicule éligible). */
  litresAcquis: number;
  litresRetenus: number;
  litresHorsPlafond: number;
  montant: number;
  details: DetailEra[];
}

const DETENTION: Record<string, string> = { propre: "En propre", location: "Location", credit_bail: "Crédit-bail", location_longue_duree: "Location longue durée" };

/** ERA de l'année : une ligne par véhicule ayant des pleins comptés, détail par usage, produit et zone. */
export function etatRecapitulatifAnnuel(lignes: readonly LigneTicpe[], vehicules: ReadonlyMap<string, InfosVehiculeDoc>, annee: number): LigneEra[] {
  const l = lignesDeLaPeriode(lignes, `${annee}-01-01`, `${annee}-12-31`).filter((x) => x.statut !== "exclu");
  const parV = new Map<string, LigneTicpe[]>();
  for (const x of l) {
    const g = parV.get(x.vehicle_id) ?? [];
    g.push(x);
    parV.set(x.vehicle_id, g);
  }
  return [...parV.entries()]
    .map(([id, g]) => {
      const v = vehicules.get(id);
      const t = totaliser(g);
      const det = new Map<string, DetailEra>();
      for (const x of g) {
        const k = `${x.categorie}|${x.zone}|${x.taux ?? "?"}`;
        const d = det.get(k) ?? {
          usage: x.categorie ? LIBELLES_CATEGORIE_COURTS[x.categorie as CategorieTicpe] : "—",
          produit: "Gazole",
          zone: x.zone ? LIBELLES_ZONE[x.zone as ZoneTicpe] : "—",
          taux: x.taux,
          litres: 0,
          montant: 0,
        };
        d.litres = Math.round((d.litres + x.litresRetenus) * 100) / 100;
        d.montant = Math.round((d.montant + x.montant) * 100) / 100;
        det.set(k, d);
      }
      return {
        vehicleId: id,
        registration: v?.registration ?? "—",
        type: v?.type ?? "—",
        genre: v?.cg_genre ?? null,
        ptacKg: ptac(v),
        energie: v?.cg_energie ?? v?.fuel_type ?? null,
        premiereImmat: v?.cg_premiere_immat ?? null,
        detention: DETENTION[v?.ownership ?? "propre"] ?? (v?.ownership ?? "—"),
        categorie: v?.eligibilite.categorie ? LIBELLES_CATEGORIE_COURTS[v.eligibilite.categorie] : "—",
        periodeDebut: v?.eligibilite.periode.debut ?? null,
        periodeFin: v?.eligibilite.periode.fin ?? null,
        litresAcquis: t.litres,
        litresRetenus: t.litresRetenus,
        litresHorsPlafond: t.litresHorsPlafond,
        montant: t.montant,
        details: [...det.values()],
      };
    })
    .sort((a, b) => a.registration.localeCompare(b.registration, "fr"));
}

/** Nom de fichier sûr pour l'archive (sans accents ni séparateurs). */
export function nomFichierSur(nom: string): string {
  return (
    nom
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 120) || "fichier"
  );
}
