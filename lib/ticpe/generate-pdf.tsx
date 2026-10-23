import "server-only";
import path from "node:path";
import { Document, Page, Text, View, StyleSheet, Font, renderToBuffer } from "@react-pdf/renderer";

// See lib/payslips/generate-pdf.tsx's comment: pdfkit's own standard
// fonts can't be traced into the Vercel serverless bundle, so this
// registers an embedded font from the project root instead — under
// both 400 and 700 (same file, only one weight is vendored) so a
// fontWeight: 700 style doesn't fall back to pdfkit's broken standard
// fonts for the unmatched weight.
const notoSansPath = path.join(process.cwd(), "assets/fonts/NotoSans-Regular.ttf");
Font.register({
  family: "NotoSans",
  fonts: [
    { src: notoSansPath, fontWeight: 400 },
    { src: notoSansPath, fontWeight: 700 },
  ],
});

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: "NotoSans" },
  title: { fontSize: 16, fontWeight: 700, marginBottom: 2 },
  subtitle: { fontSize: 9, color: "#555", marginBottom: 16 },
  table: { borderWidth: 1, borderColor: "#999" },
  headerRow: { flexDirection: "row", backgroundColor: "#e8e8e8", borderBottomWidth: 1, borderBottomColor: "#999" },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#ddd" },
  headerCell: { padding: 4, fontSize: 8, fontWeight: 700 },
  cell: { padding: 4, fontSize: 9 },
  cellRight: { padding: 4, fontSize: 9, textAlign: "right" },
  totalRow: { flexDirection: "row", backgroundColor: "#eef7f5", borderTopWidth: 1.5, borderTopColor: "#0A0F1E" },
  totalCell: { padding: 4, fontSize: 9, fontWeight: 700 },
  totalCellRight: { padding: 4, fontSize: 9, fontWeight: 700, textAlign: "right" },
  correctedTag: { fontSize: 7, color: "#b45309" },
  disclaimer: { marginTop: 20, fontSize: 7.5, color: "#888", lineHeight: 1.4 },
});

function formatNumber(n: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export interface TicpeLinePdfData {
  registration: string;
  vehicleType: string;
  entryCount: number;
  totalLiters: number;
  totalAmount: number;
  corrected: boolean;
  /** Remboursement TICPE de la ligne (exports avec barème). */
  refundAmount?: number | null;
  litersOverCap?: number | null;
}

export interface TicpeRecapPdf {
  categorie: string;
  zone: string;
  taux: number | null;
  pleins: number;
  hectolitres: number;
  montant: number;
}

export interface TicpePdfData {
  organizationName: string;
  periodStartLabel: string;
  periodEndLabel: string;
  lines: TicpeLinePdfData[];
  /** Récapitulatif 3310-TIC (exports avec barème). Absent : ancien format. */
  recap?: TicpeRecapPdf[];
  avertissement?: string;
}

function RecapTable({ recap }: { recap: TicpeRecapPdf[] }) {
  const totalHl = recap.reduce((n, r) => n + r.hectolitres, 0);
  const totalMontant = recap.reduce((n, r) => n + r.montant, 0);
  return (
    <View style={[styles.table, { marginBottom: 16 }]}>
      <View style={styles.headerRow}>
        <Text style={[styles.headerCell, { flex: 2 }]}>Activité</Text>
        <Text style={[styles.headerCell, { flex: 2 }]}>Zone</Text>
        <Text style={[styles.headerCell, { flex: 1, textAlign: "right" }]}>Taux €/hl</Text>
        <Text style={[styles.headerCell, { flex: 1, textAlign: "right" }]}>Pleins</Text>
        <Text style={[styles.headerCell, { flex: 1, textAlign: "right" }]}>Volume hl</Text>
        <Text style={[styles.headerCell, { flex: 1, textAlign: "right" }]}>Montant</Text>
      </View>
      {recap.map((r, i) => (
        <View key={i} style={styles.row}>
          <Text style={[styles.cell, { flex: 2 }]}>{r.categorie}</Text>
          <Text style={[styles.cell, { flex: 2 }]}>{r.zone}</Text>
          <Text style={[styles.cellRight, { flex: 1 }]}>{r.taux === null ? "manquant" : formatNumber(r.taux)}</Text>
          <Text style={[styles.cellRight, { flex: 1 }]}>{r.pleins}</Text>
          <Text style={[styles.cellRight, { flex: 1 }]}>{formatNumber(r.hectolitres)}</Text>
          <Text style={[styles.cellRight, { flex: 1 }]}>{formatNumber(r.montant)} €</Text>
        </View>
      ))}
      <View style={styles.totalRow}>
        <Text style={[styles.totalCell, { flex: 6 }]}>Total à reporter (annexe 3310-TIC)</Text>
        <Text style={[styles.totalCellRight, { flex: 1 }]}>{formatNumber(totalHl)}</Text>
        <Text style={[styles.totalCellRight, { flex: 1 }]}>{formatNumber(totalMontant)} €</Text>
      </View>
    </View>
  );
}

function TicpeDocument({ data }: { data: TicpePdfData }) {
  const totalLiters = data.lines.reduce((sum, l) => sum + l.totalLiters, 0);
  const totalAmount = data.lines.reduce((sum, l) => sum + l.totalAmount, 0);
  const avecBareme = Boolean(data.recap);
  const totalRefund = data.lines.reduce((sum, l) => sum + (l.refundAmount ?? 0), 0);
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{data.organizationName}</Text>
        <Text style={styles.subtitle}>
          {avecBareme ? "Récapitulatif TICPE (annexe 3310-TIC)" : "Export TICPE"} — Période du {data.periodStartLabel} au {data.periodEndLabel}
        </Text>
        {data.recap && <RecapTable recap={data.recap} />}
        {avecBareme && <Text style={[styles.subtitle, { marginBottom: 6 }]}>Détail par véhicule</Text>}

        <View style={styles.table}>
          <View style={styles.headerRow}>
            <Text style={[styles.headerCell, { flex: 2 }]}>Immatriculation</Text>
            <Text style={[styles.headerCell, { flex: 1 }]}>Type</Text>
            <Text style={[styles.headerCell, { flex: 1, textAlign: "right" }]}>Pleins</Text>
            <Text style={[styles.headerCell, { flex: 1, textAlign: "right" }]}>Litres</Text>
            <Text style={[styles.headerCell, { flex: 1, textAlign: "right" }]}>Coût d&apos;achat TTC</Text>
            {avecBareme && <Text style={[styles.headerCell, { flex: 1, textAlign: "right" }]}>Remboursement</Text>}
          </View>
          {data.lines.map((l, i) => (
            <View key={i} style={styles.row}>
              <Text style={[styles.cell, { flex: 2 }]}>{l.registration}</Text>
              <Text style={[styles.cell, { flex: 1 }]}>{l.vehicleType}</Text>
              <Text style={[styles.cellRight, { flex: 1 }]}>{l.entryCount}</Text>
              <Text style={[styles.cellRight, { flex: 1 }]}>
                {formatNumber(l.totalLiters)} L{l.corrected ? " *" : ""}
              </Text>
              <Text style={[styles.cellRight, { flex: 1 }]}>
                {formatNumber(l.totalAmount)} €{l.corrected ? " *" : ""}
              </Text>
              {avecBareme && (
                <Text style={[styles.cellRight, { flex: 1 }]}>
                  {l.refundAmount === null || l.refundAmount === undefined ? "—" : `${formatNumber(l.refundAmount)} €`}
                  {l.corrected ? " *" : ""}
                  {l.litersOverCap ? `\n(${formatNumber(l.litersOverCap)} L hors plafond)` : ""}
                </Text>
              )}
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text style={[styles.totalCell, { flex: 4 }]}>Total</Text>
            <Text style={[styles.totalCellRight, { flex: 1 }]}>{formatNumber(totalLiters)} L</Text>
            <Text style={[styles.totalCellRight, { flex: 1 }]}>{formatNumber(totalAmount)} €</Text>
            {avecBareme && <Text style={[styles.totalCellRight, { flex: 1 }]}>{formatNumber(totalRefund)} €</Text>}
          </View>
        </View>

        {data.lines.some((l) => l.corrected) && <Text style={styles.correctedTag}>* Valeur corrigée manuellement après vérification.</Text>}

        {data.avertissement && <Text style={[styles.disclaimer, { color: "#0A0F1E" }]}>{data.avertissement}</Text>}
        <Text style={styles.disclaimer}>
          {avecBareme
            ? "Aucun plafond de volume sauf celui que l'entreprise a activé (base légale non confirmée, à confirmer par l'expert-comptable) ; taux du barème GODAC (ou taux particulier de l'entreprise) à la date de chaque plein. * Ligne corrigée à la main : remboursement recalculé au prorata des litres, le récapitulatif reste celui du calcul. "
            : ""}
          Document généré automatiquement à partir des ravitaillements validés (manuels ou OCR) enregistrés dans
          GODAC pour les véhicules PL/SPL sur la période indiquée. Les véhicules dont le type (PL/SPL) n&apos;a pas
          encore été confirmé par un humain sont exclus. À vérifier avant toute déclaration officielle.
        </Text>
      </Page>
    </Document>
  );
}

export async function generateTicpePdf(data: TicpePdfData): Promise<Buffer> {
  return renderToBuffer(<TicpeDocument data={data} />);
}

export interface EraPdfLigne {
  registration: string;
  type: string;
  genre: string | null;
  ptacKg: number | null;
  energie: string | null;
  detention: string;
  categorie: string;
  litresAcquis: number;
  litresRetenus: number;
  montant: number;
  details: { usage: string; zone: string; taux: number | null; litres: number; montant: number }[];
}

export interface EraPdfData {
  organizationName: string;
  siren: string | null;
  annee: number;
  lignes: EraPdfLigne[];
  avertissement: string;
}

/** État récapitulatif annuel (ERA) TICPE, paysage : une ligne par véhicule et son détail par zone. */
function EraDocument({ data }: { data: EraPdfData }) {
  const total = data.lignes.reduce((n, l) => n + l.montant, 0);
  const totalAcquis = data.lignes.reduce((n, l) => n + l.litresAcquis, 0);
  const totalRetenu = data.lignes.reduce((n, l) => n + l.litresRetenus, 0);
  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <Text style={styles.title}>
          État récapitulatif annuel TICPE {data.annee} — {data.organizationName}
        </Text>
        <Text style={styles.subtitle}>
          {data.siren ? `SIREN ${data.siren} · ` : ""}Gazole · à établir au plus tard le 31/01/{data.annee + 1} et à tenir à disposition de l&apos;administration
        </Text>
        <View style={styles.table}>
          <View style={styles.headerRow}>
            <Text style={[styles.headerCell, { flex: 1.4 }]}>Immatriculation</Text>
            <Text style={[styles.headerCell, { flex: 0.6 }]}>Type</Text>
            <Text style={[styles.headerCell, { flex: 0.7 }]}>Genre</Text>
            <Text style={[styles.headerCell, { flex: 0.9, textAlign: "right" }]}>PTAC kg</Text>
            <Text style={[styles.headerCell, { flex: 0.8 }]}>Énergie</Text>
            <Text style={[styles.headerCell, { flex: 1.1 }]}>Détention</Text>
            <Text style={[styles.headerCell, { flex: 2.6 }]}>Usage · zone · taux : litres</Text>
            <Text style={[styles.headerCell, { flex: 1, textAlign: "right" }]}>Acquis L</Text>
            <Text style={[styles.headerCell, { flex: 1, textAlign: "right" }]}>Retenus L</Text>
            <Text style={[styles.headerCell, { flex: 1, textAlign: "right" }]}>Montant</Text>
          </View>
          {data.lignes.map((l, i) => (
            <View key={i} style={styles.row} wrap={false}>
              <Text style={[styles.cell, { flex: 1.4 }]}>{l.registration}</Text>
              <Text style={[styles.cell, { flex: 0.6 }]}>{l.type}</Text>
              <Text style={[styles.cell, { flex: 0.7 }]}>{l.genre ?? "—"}</Text>
              <Text style={[styles.cellRight, { flex: 0.9 }]}>{l.ptacKg ?? "—"}</Text>
              <Text style={[styles.cell, { flex: 0.8 }]}>{l.energie ?? "—"}</Text>
              <Text style={[styles.cell, { flex: 1.1 }]}>{l.detention}</Text>
              <Text style={[styles.cell, { flex: 2.6, fontSize: 7.5 }]}>
                {l.details.map((d) => `${d.usage} · ${d.zone} · ${d.taux === null ? "taux manquant" : `${formatNumber(d.taux)} €/hl`} : ${formatNumber(d.litres)} L`).join("\n")}
              </Text>
              <Text style={[styles.cellRight, { flex: 1 }]}>{formatNumber(l.litresAcquis)}</Text>
              <Text style={[styles.cellRight, { flex: 1 }]}>{formatNumber(l.litresRetenus)}</Text>
              <Text style={[styles.cellRight, { flex: 1 }]}>{formatNumber(l.montant)} €</Text>
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text style={[styles.totalCell, { flex: 8.1 }]}>Total</Text>
            <Text style={[styles.totalCellRight, { flex: 1 }]}>{formatNumber(totalAcquis)}</Text>
            <Text style={[styles.totalCellRight, { flex: 1 }]}>{formatNumber(totalRetenu)}</Text>
            <Text style={[styles.totalCellRight, { flex: 1 }]}>{formatNumber(total)} €</Text>
          </View>
        </View>
        <Text style={[styles.disclaimer, { color: "#0A0F1E" }]}>{data.avertissement}</Text>
        <Text style={styles.disclaimer}>
          Modèle GODAC établi à partir des pleins de gazole validés (décret n° 2025-255 du 19/03/2025) ; présentation à confirmer par l&apos;expert-comptable.
          Aucun plafond de volume sauf celui que l&apos;entreprise a activé (base légale non confirmée, à confirmer par l&apos;expert-comptable). Justificatifs conservés par l&apos;entreprise : factures et tickets carburant, relevés de cartes,
          livraisons de cuve, cartes grises.
        </Text>
      </Page>
    </Document>
  );
}

export async function generateEraPdf(data: EraPdfData): Promise<Buffer> {
  return renderToBuffer(<EraDocument data={data} />);
}
