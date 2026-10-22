import "server-only";
import ExcelJS from "exceljs";
import type { LigneEra } from "@/lib/ticpe/documents";
import { formatJour } from "@/lib/ticpe/bareme";

/**
 * Classeur de l'état récapitulatif annuel (ERA) TICPE : une ligne par
 * véhicule (feuille « ERA ») et le détail par usage, produit et zone
 * (feuille « Détail »). À établir au plus tard le 31 janvier N+1 et à
 * tenir à disposition de l'administration.
 */
export async function construireClasseurEra({
  organisation,
  siren,
  annee,
  lignes,
  avertissement,
}: {
  organisation: string;
  siren: string | null;
  annee: number;
  lignes: LigneEra[];
  avertissement: string;
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "GODAC";
  wb.created = new Date();
  const f = wb.addWorksheet("ERA");
  f.addRow([`État récapitulatif annuel TICPE ${annee} — ${organisation}${siren ? ` (SIREN ${siren})` : ""}`]).font = { bold: true };
  f.addRow([`Établi le ${formatJour(new Date().toISOString().slice(0, 10))} à partir des pleins de gazole validés enregistrés dans GODAC. ${avertissement}`]);
  f.addRow(["Format du modèle GODAC, à confirmer par l'expert-comptable (décret n° 2025-255 du 19/03/2025)."]);
  f.addRow([]);
  f.addRow([
    "Immatriculation",
    "Type",
    "Genre (J.1)",
    "PTAC (kg)",
    "Énergie",
    "1re immatriculation",
    "Détention",
    "Usage",
    "Éligible du",
    "Éligible au",
    "Gazole acquis (L)",
    "Retenu (L)",
    "Hors plafond (L)",
    "Montant remboursable (€)",
  ]).font = { bold: true };
  for (const l of lignes) {
    f.addRow([
      l.registration,
      l.type,
      l.genre ?? "",
      l.ptacKg ?? "non renseigné",
      l.energie ?? "",
      l.premiereImmat ? formatJour(l.premiereImmat) : "",
      l.detention,
      l.categorie,
      l.periodeDebut ? formatJour(l.periodeDebut) : "",
      l.periodeFin ? formatJour(l.periodeFin) : "",
      l.litresAcquis,
      l.litresRetenus,
      l.litresHorsPlafond,
      l.montant,
    ]);
  }
  f.addRow([
    "TOTAL",
    ...Array(9).fill(""),
    Number(lignes.reduce((n, l) => n + l.litresAcquis, 0).toFixed(2)),
    Number(lignes.reduce((n, l) => n + l.litresRetenus, 0).toFixed(2)),
    Number(lignes.reduce((n, l) => n + l.litresHorsPlafond, 0).toFixed(2)),
    Number(lignes.reduce((n, l) => n + l.montant, 0).toFixed(2)),
  ]).font = { bold: true };
  f.columns.forEach((c) => {
    c.width = 17;
  });

  const d = wb.addWorksheet("Détail");
  d.addRow(["Immatriculation", "Usage", "Produit", "Zone", "Taux (€/hl)", "Litres retenus", "Montant (€)"]).font = { bold: true };
  for (const l of lignes) for (const x of l.details) d.addRow([l.registration, x.usage, x.produit, x.zone, x.taux ?? "taux manquant", x.litres, x.montant]);
  d.columns.forEach((c) => {
    c.width = 20;
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
