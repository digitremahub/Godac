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
}

export interface TicpePdfData {
  organizationName: string;
  periodStartLabel: string;
  periodEndLabel: string;
  lines: TicpeLinePdfData[];
}

function TicpeDocument({ data }: { data: TicpePdfData }) {
  const totalLiters = data.lines.reduce((sum, l) => sum + l.totalLiters, 0);
  const totalAmount = data.lines.reduce((sum, l) => sum + l.totalAmount, 0);
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{data.organizationName}</Text>
        <Text style={styles.subtitle}>
          Export TICPE — Période du {data.periodStartLabel} au {data.periodEndLabel} (véhicules PL/SPL)
        </Text>

        <View style={styles.table}>
          <View style={styles.headerRow}>
            <Text style={[styles.headerCell, { flex: 2 }]}>Immatriculation</Text>
            <Text style={[styles.headerCell, { flex: 1 }]}>Type</Text>
            <Text style={[styles.headerCell, { flex: 1, textAlign: "right" }]}>Pleins</Text>
            <Text style={[styles.headerCell, { flex: 1, textAlign: "right" }]}>Litres</Text>
            <Text style={[styles.headerCell, { flex: 1, textAlign: "right" }]}>Coût d&apos;achat TTC</Text>
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
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text style={[styles.totalCell, { flex: 4 }]}>Total</Text>
            <Text style={[styles.totalCellRight, { flex: 1 }]}>{formatNumber(totalLiters)} L</Text>
            <Text style={[styles.totalCellRight, { flex: 1 }]}>{formatNumber(totalAmount)} €</Text>
          </View>
        </View>

        {data.lines.some((l) => l.corrected) && <Text style={styles.correctedTag}>* Valeur corrigée manuellement après vérification.</Text>}

        <Text style={styles.disclaimer}>
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
