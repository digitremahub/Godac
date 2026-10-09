import "server-only";
import { Document, Page, Text, View, StyleSheet, renderToBuffer, Font } from "@react-pdf/renderer";

Font.register({
  family: "Helvetica",
  fonts: [{ src: "Helvetica" }],
});

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica" },
  title: { fontSize: 14, fontWeight: 700, marginBottom: 4 },
  subtitle: { fontSize: 9, color: "#555", marginBottom: 16 },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  box: { width: "48%" },
  label: { fontSize: 8, color: "#888", marginBottom: 2 },
  value: { fontSize: 10, marginBottom: 6 },
  hr: { borderBottomWidth: 1, borderBottomColor: "#ccc", marginVertical: 10 },
  lineRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  lineLabel: { fontSize: 10 },
  lineValue: { fontSize: 10, textAlign: "right" },
  netRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, backgroundColor: "#eef7f5" },
  netLabel: { fontSize: 11, fontWeight: 700 },
  netValue: { fontSize: 11, fontWeight: 700, textAlign: "right" },
  disclaimer: { marginTop: 24, fontSize: 7.5, color: "#888", lineHeight: 1.4 },
});

function formatEuro(n: number): string {
  return `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

export interface PayslipPdfData {
  organizationName: string;
  employeeName: string;
  employeeRoleTitle: string | null;
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
        <Text style={styles.title}>{data.organizationName}</Text>
        <Text style={styles.subtitle}>Bulletin de paie — {data.periodLabel}</Text>

        <View style={styles.row}>
          <View style={styles.box}>
            <Text style={styles.label}>Employeur</Text>
            <Text style={styles.value}>{data.organizationName}</Text>
          </View>
          <View style={styles.box}>
            <Text style={styles.label}>Salarié</Text>
            <Text style={styles.value}>{data.employeeName}</Text>
            {data.employeeRoleTitle && <Text style={styles.value}>{data.employeeRoleTitle}</Text>}
          </View>
        </View>

        <Text style={styles.label}>Période</Text>
        <Text style={styles.value}>
          Du {data.periodStartLabel} au {data.periodEndLabel}
        </Text>

        <View style={styles.hr} />

        <View style={styles.lineRow}>
          <Text style={styles.lineLabel}>Salaire mensuel brut</Text>
          <Text style={styles.lineValue}>{formatEuro(data.grossSalary)}</Text>
        </View>
        <View style={styles.lineRow}>
          <Text style={styles.lineLabel}>Cotisations sociales (estimation)</Text>
          <Text style={styles.lineValue}>- {formatEuro(estimatedContributions)}</Text>
        </View>
        <View style={styles.netRow}>
          <Text style={styles.netLabel}>Net à payer</Text>
          <Text style={styles.netValue}>{formatEuro(data.netSalary)}</Text>
        </View>

        <Text style={styles.disclaimer}>
          Document indicatif généré automatiquement à partir des données contractuelles enregistrées dans GODAC
          (salaire brut/net saisis par la direction). Il ne détaille pas les cotisations ligne par ligne, n&apos;intègre
          pas le prélèvement à la source personnalisé, et ne constitue ni un bulletin de paie officiel au sens de
          l&apos;article R3243-1 du code du travail, ni une déclaration sociale nominative (DSN). À faire valider par
          votre expert-comptable ou votre logiciel de paie avant toute remise officielle au salarié.
        </Text>
      </Page>
    </Document>
  );
}

export async function generatePayslipPdf(data: PayslipPdfData): Promise<Buffer> {
  return renderToBuffer(<PayslipDocument data={data} />);
}
