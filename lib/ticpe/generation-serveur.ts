import "server-only";
import type { CalculTicpe } from "@/lib/ticpe/calcul-serveur";
import { documentPeriode, etatRecapitulatifAnnuel, type DocumentPeriode, type InfosVehiculeDoc, type LigneEra } from "@/lib/ticpe/documents";
import { LIBELLES_CATEGORIE_COURTS, LIBELLES_ZONE, formatJour } from "@/lib/ticpe/bareme";
import { lignesDeLaPeriode } from "@/lib/ticpe/montant";
import { AVERTISSEMENT_TICPE } from "@/lib/ticpe/reglages";
import { buildTicpeWorkbook, type TicpeExportRow, type TicpePleinRow, type TicpeRecapRow } from "@/lib/utils/excel";
import { generateEraPdf, generateTicpePdf } from "@/lib/ticpe/generate-pdf";
import { construireClasseurEra } from "@/lib/ticpe/excel-era";

export function infosVehicules(calcul: CalculTicpe): Map<string, InfosVehiculeDoc> {
  return new Map(
    [...calcul.evalues.entries()].map(([id, e]) => [
      id,
      {
        registration: e.vehicule.registration,
        type: e.vehicule.type,
        ptac_kg: e.vehicule.ptac_kg,
        fuel_type: e.vehicule.fuel_type,
        cg_genre: e.vehicule.cg_genre ?? null,
        cg_energie: e.vehicule.cg_energie ?? null,
        cg_premiere_immat: e.vehicule.cg_premiere_immat ?? null,
        ownership: e.vehicule.ownership ?? null,
        eligibilite: e.eligibilite,
      },
    ]),
  );
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface RecapGenere {
  doc: DocumentPeriode;
  rows: (TicpeExportRow & { vehicleId: string })[];
  recapRows: TicpeRecapRow[];
  xlsx: Buffer;
  pdf: Buffer;
}

/** Récapitulatif 3310-TIC d'une période : Excel (récapitulatif, véhicules, pleins) et PDF. */
export async function genererRecapPeriode(calcul: CalculTicpe, organisation: string, debut: string, fin: string): Promise<RecapGenere> {
  const vehicules = infosVehicules(calcul);
  const doc = documentPeriode(calcul.lignes, vehicules, debut, fin);
  const comptees = lignesDeLaPeriode(calcul.lignes, debut, fin).filter((l) => l.statut !== "exclu");

  // Coût d'achat TTC des pleins comptés (colonne historique de l'export).
  const cout = new Map<string, number>();
  for (const l of comptees) {
    const p = calcul.pleins.get(l.id);
    const montant = p?.unit_price !== null && p?.unit_price !== undefined ? Number(p.unit_price) * l.litres : 0;
    cout.set(l.vehicle_id, (cout.get(l.vehicle_id) ?? 0) + (Number.isFinite(montant) ? montant : 0));
  }
  const rows = doc.vehicules.map((v) => ({
    vehicleId: v.vehicleId,
    registration: v.registration,
    vehicleType: v.type,
    ptacKg: v.ptacKg,
    entryCount: v.pleins,
    totalLiters: v.litres,
    totalAmount: r2(cout.get(v.vehicleId) ?? 0),
    refundAmount: v.montant,
    litersOverCap: v.litresHorsPlafond,
  }));
  const recapRows: TicpeRecapRow[] = doc.recap.map((r) => ({
    categorie: LIBELLES_CATEGORIE_COURTS[r.categorie],
    zone: LIBELLES_ZONE[r.zone],
    taux: r.taux,
    pleins: r.pleins,
    hectolitres: r.hectolitres,
    montant: r.montant,
  }));
  const pleins: TicpePleinRow[] = comptees
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
    .map((l) => {
      const p = calcul.pleins.get(l.id);
      const cuve = p?.tank_id ? calcul.cuves.get(p.tank_id) : undefined;
      return {
        date: new Date(l.occurred_at).toLocaleString("fr-FR", { timeZone: "Europe/Paris" }),
        registration: vehicules.get(l.vehicle_id)?.registration ?? "—",
        origine: p?.tank_id ? `Cuve ${cuve?.name ?? ""}`.trim() : `Station ${p?.station_name ?? ""}`.trim(),
        zone: l.zone ? LIBELLES_ZONE[l.zone] : "—",
        taux: l.taux,
        litres: l.litres,
        litresRetenus: l.litresRetenus,
        montant: l.montant,
        justificatif: l.justificatif.libelle,
      };
    });

  const avertissement = `${AVERTISSEMENT_TICPE}${doc.tauxManquants > 0 ? ` Attention : ${doc.tauxManquants} plein(s) sans taux au barème, non chiffrés.` : ""}`;
  const [xlsx, pdf] = await Promise.all([
    buildTicpeWorkbook({ organizationName: organisation, periodStart: debut, periodEnd: fin, rows, recap: recapRows, pleins, avertissement }),
    generateTicpePdf({
      organizationName: organisation,
      periodStartLabel: formatJour(debut),
      periodEndLabel: formatJour(fin),
      lines: rows.map((r) => ({ registration: r.registration, vehicleType: r.vehicleType, entryCount: r.entryCount, totalLiters: r.totalLiters, totalAmount: r.totalAmount, corrected: false, refundAmount: r.refundAmount, litersOverCap: r.litersOverCap })),
      recap: recapRows,
      avertissement,
    }),
  ]);
  return { doc, rows, recapRows, xlsx, pdf };
}

export interface EraGenere {
  lignes: LigneEra[];
  xlsx: Buffer;
  pdf: Buffer;
  total: number;
  litres: number;
}

/** État récapitulatif annuel (ERA) : Excel et PDF. */
export async function genererEra(calcul: CalculTicpe, organisation: string, siren: string | null, annee: number): Promise<EraGenere> {
  const lignes = etatRecapitulatifAnnuel(calcul.lignes, infosVehicules(calcul), annee);
  const [xlsx, pdf] = await Promise.all([
    construireClasseurEra({ organisation, siren, annee, lignes, avertissement: AVERTISSEMENT_TICPE }),
    generateEraPdf({ organizationName: organisation, siren, annee, lignes, avertissement: AVERTISSEMENT_TICPE }),
  ]);
  return { lignes, xlsx, pdf, total: r2(lignes.reduce((n, l) => n + l.montant, 0)), litres: r2(lignes.reduce((n, l) => n + l.litresRetenus, 0)) };
}
