import "server-only";
import ExcelJS from "exceljs";

export interface TicpeExportRow {
  registration: string;
  vehicleType: string;
  /** PTAC en kg ; null = non renseigné (à vérifier avant dépôt). */
  ptacKg?: number | null;
  entryCount: number;
  totalLiters: number;
  totalAmount: number;
  /** Montant de remboursement TICPE (€) ; absent pour les exports d'avant le barème. */
  refundAmount?: number | null;
  /** Litres au-delà du plafond par véhicule (exclus du montant). */
  litersOverCap?: number | null;
}

/** Ligne du récapitulatif 3310-TIC (activité / zone / taux). */
export interface TicpeRecapRow {
  categorie: string;
  zone: string;
  taux: number | null;
  pleins: number;
  hectolitres: number;
  montant: number;
}

/** Détail d'un plein compté (feuille « Pleins »). */
export interface TicpePleinRow {
  date: string;
  registration: string;
  origine: string;
  zone: string;
  taux: number | null;
  litres: number;
  litresRetenus: number;
  montant: number;
  justificatif: string;
}

/**
 * Builds the TICPE export workbook (Module 7). Only ever receives
 * PL/SPL rows — the VL exclusion happens one layer up, in
 * lib/business/ticpe.ts via filterTicpeEligibleVehicles, so this
 * function has no VL/PL/SPL branching of its own to get wrong.
 */
export async function buildTicpeWorkbook({
  organizationName,
  periodStart,
  periodEnd,
  rows,
  recap,
  pleins,
  avertissement,
}: {
  organizationName: string;
  periodStart: string;
  periodEnd: string;
  rows: TicpeExportRow[];
  recap?: TicpeRecapRow[];
  pleins?: TicpePleinRow[];
  avertissement?: string;
}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "GODAC";
  workbook.created = new Date();

  if (recap) {
    const r = workbook.addWorksheet("Récapitulatif 3310-TIC");
    r.addRow([`Récapitulatif TICPE (annexe 3310-TIC) — ${organizationName}`]).font = { bold: true };
    r.addRow([`Période : ${periodStart} au ${periodEnd} (jours entiers, heure de Paris)`]);
    if (avertissement) r.addRow([avertissement]);
    r.addRow(["Volumes retenus après plafond par véhicule. Taux du barème GODAC (ou taux particulier de l'entreprise) à la date de chaque plein."]);
    r.addRow([]);
    r.addRow(["Activité", "Zone", "Taux (€/hl)", "Pleins", "Volume (hl)", "Montant (€)"]).font = { bold: true };
    for (const x of recap) r.addRow([x.categorie, x.zone, x.taux ?? "taux manquant", x.pleins, x.hectolitres, x.montant]);
    r.addRow([
      "TOTAL",
      "",
      "",
      recap.reduce((n, x) => n + x.pleins, 0),
      Number(recap.reduce((n, x) => n + x.hectolitres, 0).toFixed(2)),
      Number(recap.reduce((n, x) => n + x.montant, 0).toFixed(2)),
    ]).font = { bold: true };
    r.columns.forEach((c) => {
      c.width = 24;
    });
  }

  const sheet = workbook.addWorksheet("TICPE");
  sheet.addRow([`Export TICPE — ${organizationName}`]);
  sheet.addRow([`Période: ${periodStart} au ${periodEnd}`]);
  sheet.addRow([`Périmètre : gazole uniquement (AdBlue exclu), pleins validés, véhicules PL/SPL de PTAC ≥ 7,5 t (VL exclus)`]);
  sheet.addRow([`Période en jours entiers, heure de Paris. Coût d'achat = montant TTC enregistré, distinct du remboursement TICPE.`]);
  sheet.addRow([]);

  const header = sheet.addRow([
    "Immatriculation",
    "Type",
    "PTAC (kg)",
    "Nb ravitaillements",
    "Litres totaux",
    "Coût d'achat TTC (€)",
    ...(recap ? ["Litres hors plafond", "Remboursement TICPE (€)"] : []),
  ]);
  header.font = { bold: true };

  for (const row of rows) {
    sheet.addRow([
      row.registration,
      row.vehicleType,
      row.ptacKg ?? "non renseigné — à vérifier",
      row.entryCount,
      Number(row.totalLiters.toFixed(2)),
      Number(row.totalAmount.toFixed(2)),
      ...(recap ? [row.litersOverCap ?? 0, row.refundAmount ?? null] : []),
    ]);
  }

  const totalsRow = sheet.addRow([
    "TOTAL",
    "",
    "",
    rows.reduce((sum, r) => sum + r.entryCount, 0),
    Number(rows.reduce((sum, r) => sum + r.totalLiters, 0).toFixed(2)),
    Number(rows.reduce((sum, r) => sum + r.totalAmount, 0).toFixed(2)),
    ...(recap
      ? [Number(rows.reduce((sum, r) => sum + (r.litersOverCap ?? 0), 0).toFixed(2)), Number(rows.reduce((sum, r) => sum + (r.refundAmount ?? 0), 0).toFixed(2))]
      : []),
  ]);
  totalsRow.font = { bold: true };

  sheet.columns.forEach((col) => {
    col.width = 22;
  });

  if (pleins) {
    const d = workbook.addWorksheet("Pleins");
    d.addRow(["Date", "Immatriculation", "Origine", "Zone", "Taux (€/hl)", "Litres", "Litres retenus", "Montant (€)", "Justificatif à conserver"]).font = { bold: true };
    for (const x of pleins) d.addRow([x.date, x.registration, x.origine, x.zone, x.taux ?? "taux manquant", x.litres, x.litresRetenus, x.montant, x.justificatif]);
    d.columns.forEach((c) => {
      c.width = 20;
    });
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
