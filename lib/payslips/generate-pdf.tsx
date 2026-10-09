import "server-only";
import path from "node:path";
import { Document, Page, Text, View, StyleSheet, Font, renderToBuffer } from "@react-pdf/renderer";

// react-pdf's own "standard" fonts (Helvetica, etc.) are loaded by
// pdfkit from node_modules/pdfkit/js/standard-fonts/* at render time,
// via a dynamically-built require path — Next's output file tracing
// can't follow that, and outputFileTracingIncludes can't force a
// node_modules path into the Vercel bundle either (confirmed directly:
// even a single, non-glob path there gets silently dropped), so every
// PDF generation crashed in production with "Cannot find module
// '.../pdfkit/js/standard-fonts/Helvetica.cjs'". Registering our own
// embedded font from a project-root path (traced the same way
// content/help/*.md already is, see next.config.mjs) sidesteps pdfkit's
// standard-font loading entirely.
// Only one weight is actually vendored — registered for both 400 and
// 700 (same file) so a style requesting fontWeight: 700 still resolves
// to "NotoSans" instead of react-pdf falling back to pdfkit's broken
// standard-font loading for the unmatched weight (the second, more
// subtle cause of the same "Cannot find module .../Helvetica.cjs"
// crash, confirmed in production after the first fix alone).
const notoSansPath = path.join(process.cwd(), "assets/fonts/NotoSans-Regular.ttf");
Font.register({
  family: "NotoSans",
  fonts: [
    { src: notoSansPath, fontWeight: 400 },
    { src: notoSansPath, fontWeight: 700 },
  ],
});

const styles = StyleSheet.create({
  page: { padding: 28, fontSize: 9, fontFamily: "NotoSans" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
  employerBox: { width: "48%", borderWidth: 1, borderColor: "#999", padding: 8 },
  employerName: { fontSize: 10, fontWeight: 700, marginBottom: 2 },
  employerLine: { fontSize: 8, color: "#333", marginBottom: 1 },
  titleBox: { width: "48%", alignItems: "flex-end" },
  title: { fontSize: 20, fontWeight: 700, letterSpacing: 1 },
  periodLine: { fontSize: 8.5, marginTop: 6, color: "#333" },
  employeeBox: { borderWidth: 1, borderColor: "#999", padding: 8, marginBottom: 14, width: "55%", marginLeft: "auto" },
  employeeName: { fontSize: 10, fontWeight: 700, marginBottom: 2 },
  employeeLine: { fontSize: 8.5, color: "#333", marginBottom: 1 },
  table: { borderWidth: 1, borderColor: "#999" },
  tableHeaderRow: { flexDirection: "row", backgroundColor: "#e8e8e8", borderBottomWidth: 1, borderBottomColor: "#999" },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#ddd" },
  cellDesignation: { flex: 3, padding: 4, fontSize: 9 },
  cellValue: { flex: 1, padding: 4, fontSize: 9, textAlign: "right" },
  headerCell: { padding: 4, fontSize: 8, fontWeight: 700 },
  netRow: { flexDirection: "row", marginTop: 12, justifyContent: "flex-end" },
  netBox: { borderWidth: 1.5, borderColor: "#0A0F1E", padding: 8, width: 180, alignItems: "center" },
  netLabel: { fontSize: 9, fontWeight: 700, marginBottom: 2 },
  netValue: { fontSize: 15, fontWeight: 700 },
  disclaimer: { marginTop: 28, fontSize: 7.5, color: "#888", lineHeight: 1.4 },
});

function formatEuro(n: number): string {
  return `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

export interface PayslipPdfData {
  organizationName: string;
  organizationAddress: string | null;
  organizationSiret: string | null;
  employeeName: string;
  employeeRoleTitle: string | null;
  employeeAddress: string | null;
  periodLabel: string;
  periodStartLabel: string;
  periodEndLabel: string;
  grossSalary: number;
  netSalary: number;
}

function PayslipDocument({ data }: { data: PayslipPdfData }) {
  const estimatedContributions = data.grossSalary - data.netSalary;
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View style={styles.employerBox}>
            <Text style={styles.employerName}>{data.organizationName}</Text>
            {data.organizationAddress && <Text style={styles.employerLine}>{data.organizationAddress}</Text>}
            {data.organizationSiret && <Text style={styles.employerLine}>SIRET {data.organizationSiret}</Text>}
          </View>
          <View style={styles.titleBox}>
            <Text style={styles.title}>BULLETIN DE PAIE</Text>
            <Text style={styles.periodLine}>
              Période du {data.periodStartLabel} au {data.periodEndLabel}
            </Text>
          </View>
        </View>

        <View style={styles.employeeBox}>
          <Text style={styles.employeeName}>{data.employeeName}</Text>
          {data.employeeRoleTitle && <Text style={styles.employeeLine}>{data.employeeRoleTitle}</Text>}
          {data.employeeAddress && <Text style={styles.employeeLine}>{data.employeeAddress}</Text>}
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.headerCell, { flex: 3 }]}>Désignation</Text>
            <Text style={[styles.headerCell, { flex: 1, textAlign: "right" }]}>Gain</Text>
            <Text style={[styles.headerCell, { flex: 1, textAlign: "right" }]}>Retenue</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.cellDesignation}>Salaire mensuel brut</Text>
            <Text style={styles.cellValue}>{formatEuro(data.grossSalary)}</Text>
            <Text style={styles.cellValue}></Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.cellDesignation}>Cotisations sociales (estimation globale)</Text>
            <Text style={styles.cellValue}></Text>
            <Text style={styles.cellValue}>{formatEuro(estimatedContributions)}</Text>
          </View>
        </View>

        <View style={styles.netRow}>
          <View style={styles.netBox}>
            <Text style={styles.netLabel}>NET À PAYER</Text>
            <Text style={styles.netValue}>{formatEuro(data.netSalary)}</Text>
          </View>
        </View>

        <Text style={styles.disclaimer}>
          Document indicatif généré automatiquement à partir des données contractuelles enregistrées dans GODAC
          (salaire brut/net saisis par la direction). Il ne détaille pas les cotisations ligne par ligne (URSSAF,
          retraite, prévoyance...), n&apos;intègre pas le prélèvement à la source personnalisé, et ne constitue ni un
          bulletin de paie officiel au sens de l&apos;article R3243-1 du code du travail, ni une déclaration sociale
          nominative (DSN). À faire valider par votre expert-comptable ou votre logiciel de paie avant toute remise
          officielle au salarié.
        </Text>
      </Page>
    </Document>
  );
}

export async function generatePayslipPdf(data: PayslipPdfData): Promise<Buffer> {
  return renderToBuffer(<PayslipDocument data={data} />);
}
