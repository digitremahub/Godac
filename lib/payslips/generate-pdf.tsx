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
  summaryRow: { flexDirection: "row", flexWrap: "wrap", marginBottom: 10 },
  summaryLine: { fontSize: 8, color: "#333", marginRight: 14 },
  table: { borderWidth: 1, borderColor: "#999" },
  tableHeaderRow: { flexDirection: "row", backgroundColor: "#e8e8e8", borderBottomWidth: 1, borderBottomColor: "#999" },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#ddd" },
  cellDesignation: { flex: 3, padding: 4, fontSize: 9 },
  cellValue: { flex: 1, padding: 4, fontSize: 9, textAlign: "right" },
  cellNote: { fontSize: 7, color: "#888" },
  tableSubtotalRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#ddd", backgroundColor: "#f5f5f5" },
  cellDesignationBold: { flex: 3, padding: 4, fontSize: 9 },
  cellValueBold: { flex: 1, padding: 4, fontSize: 9, textAlign: "right" },
  headerCell: { padding: 4, fontSize: 8, fontWeight: 700 },
  netRow: { flexDirection: "row", marginTop: 12, justifyContent: "flex-end" },
  netBox: { borderWidth: 1.5, borderColor: "#0A0F1E", padding: 8, width: 180, alignItems: "center" },
  netLabel: { fontSize: 9, fontWeight: 700, marginBottom: 2 },
  netValue: { fontSize: 15, fontWeight: 700 },
  cumulRow: { flexDirection: "row", marginTop: 8, justifyContent: "flex-end" },
  cumulBox: { borderWidth: 1, borderColor: "#999", padding: 6, width: 180, alignItems: "center" },
  cumulLabel: { fontSize: 7.5, color: "#666", marginBottom: 2 },
  cumulValue: { fontSize: 8.5, color: "#333" },
  disclaimer: { marginTop: 28, fontSize: 7.5, color: "#888", lineHeight: 1.4 },
});

/**
 * fr-FR's toLocaleString groups thousands with U+202F (narrow no-break
 * space) — a codepoint the vendored NotoSans-Regular.ttf has no glyph
 * for, so pdfkit fell back to rendering a stray box glyph overlapping
 * the adjacent digits ("1⫽867,06" instead of "1 867,06"). Swapping it
 * (and the plain U+00A0 non-break space some locales use) for an
 * ordinary space sidesteps the missing glyph entirely.
 */
function formatEuro(n: number): string {
  const grouped = n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[  ]/g, " ");
  return `${grouped} €`;
}

export interface PayslipPdfData {
  organizationName: string;
  organizationAddress: string | null;
  organizationSiret: string | null;
  organizationLegalForm: string | null;
  organizationApeCode: string | null;
  organizationConventionCollective: string | null;
  organizationUrssafNumber: string | null;
  employeeName: string;
  employeeRoleTitle: string | null;
  employeeAddress: string | null;
  employeeMatricule: string | null;
  employeeSocialSecurityNumber: string | null;
  employeeClassification: string | null;
  employeeContractTypeLabel: string | null;
  employeeHireDateLabel: string | null;
  periodLabel: string;
  periodStartLabel: string;
  periodEndLabel: string;
  generatedAtLabel: string;
  grossSalary: number;
  netSalary: number;
  /** Saisis au moment de la génération (voir /equipe/paie/heures) — pas de cotisation calculée dessus, ajoutés tels quels au net à payer. */
  mealVouchersAmount?: number | null;
  bonusAmount?: number | null;
  /** Base horaire contractuelle (user_contracts) — informatif, ne sert pas à recalculer le salaire. */
  contractualMonthlyHours: number | null;
  /** Heures réellement badgées (module Pointeuse) sur la période — null si le module n'est pas activé. */
  workedHours: number | null;
  /** Jours ouvrés de congé approuvé sur la période (lib/business/payroll.ts countWeekdays). */
  leaveDaysTaken: number;
  /** Cumuls depuis le 1er janvier, cette fiche incluse — somme des bulletins déjà générés cette année-là. */
  cumulGrossYTD: number;
  cumulNetYTD: number;
  /**
   * Grille de cotisations configurée par la direction (voir
   * supabase/migrations/20260101000094 et PayslipContributionLinesPanel),
   * déjà appliquée au brut — null/vide quand l'organisation n'a encore
   * rien configuré, auquel cas la ligne globale "estimation" reste
   * affichée (comportement historique, inchangé).
   */
  contributionLines: { label: string; salarialAmount: number; patronalAmount: number }[] | null;
}

function PayslipDocument({ data }: { data: PayslipPdfData }) {
  const estimatedContributions = data.grossSalary - data.netSalary;
  const mealVouchers = data.mealVouchersAmount ?? 0;
  const bonus = data.bonusAmount ?? 0;
  const totalNet = data.netSalary + mealVouchers + bonus;
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View style={styles.employerBox}>
            <Text style={styles.employerName}>
              {data.organizationName}
              {data.organizationLegalForm ? ` (${data.organizationLegalForm})` : ""}
            </Text>
            {data.organizationAddress && <Text style={styles.employerLine}>{data.organizationAddress}</Text>}
            {data.organizationSiret && <Text style={styles.employerLine}>SIRET {data.organizationSiret}</Text>}
            {data.organizationApeCode && <Text style={styles.employerLine}>Code APE/NAF {data.organizationApeCode}</Text>}
            {data.organizationConventionCollective && (
              <Text style={styles.employerLine}>Convention collective : {data.organizationConventionCollective}</Text>
            )}
            {data.organizationUrssafNumber && <Text style={styles.employerLine}>N° cotisant URSSAF {data.organizationUrssafNumber}</Text>}
          </View>
          <View style={styles.titleBox}>
            <Text style={styles.title}>BULLETIN DE PAIE</Text>
            <Text style={styles.periodLine}>
              Période du {data.periodStartLabel} au {data.periodEndLabel}
            </Text>
            <Text style={styles.periodLine}>Émis le {data.generatedAtLabel}</Text>
          </View>
        </View>

        <View style={styles.employeeBox}>
          <Text style={styles.employeeName}>{data.employeeName}</Text>
          {data.employeeAddress && <Text style={styles.employeeLine}>{data.employeeAddress}</Text>}
          {data.employeeRoleTitle && <Text style={styles.employeeLine}>Poste : {data.employeeRoleTitle}</Text>}
          {data.employeeClassification && <Text style={styles.employeeLine}>Qualification : {data.employeeClassification}</Text>}
          {data.employeeContractTypeLabel && <Text style={styles.employeeLine}>Contrat : {data.employeeContractTypeLabel}</Text>}
          {data.employeeHireDateLabel && <Text style={styles.employeeLine}>Entrée le {data.employeeHireDateLabel}</Text>}
          {data.employeeMatricule && <Text style={styles.employeeLine}>Matricule {data.employeeMatricule}</Text>}
          {data.employeeSocialSecurityNumber && <Text style={styles.employeeLine}>N° sécurité sociale {data.employeeSocialSecurityNumber}</Text>}
        </View>

        <View style={styles.summaryRow}>
          {data.contractualMonthlyHours !== null && (
            <Text style={styles.summaryLine}>Base horaire mensuelle : {data.contractualMonthlyHours} h</Text>
          )}
          {data.workedHours !== null && (
            <Text style={styles.summaryLine}>Heures travaillées (pointeuse) : {data.workedHours.toFixed(2)} h</Text>
          )}
          {data.leaveDaysTaken > 0 && (
            <Text style={styles.summaryLine}>
              Congés pris sur la période : {data.leaveDaysTaken} jour{data.leaveDaysTaken > 1 ? "s" : ""}
            </Text>
          )}
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
          {data.contributionLines && data.contributionLines.length > 0 ? (
            <>
              {data.contributionLines.map((line, i) => (
                <View key={i} style={styles.tableRow}>
                  <View style={styles.cellDesignation}>
                    <Text>{line.label}</Text>
                    {line.patronalAmount > 0 && (
                      <Text style={styles.cellNote}>Charge patronale indicative : {formatEuro(line.patronalAmount)}</Text>
                    )}
                  </View>
                  <Text style={styles.cellValue}></Text>
                  <Text style={styles.cellValue}>{formatEuro(line.salarialAmount)}</Text>
                </View>
              ))}
              <View style={styles.tableSubtotalRow}>
                <Text style={styles.cellDesignationBold}>Total des retenues</Text>
                <Text style={styles.cellValueBold}></Text>
                <Text style={styles.cellValueBold}>
                  {formatEuro(data.contributionLines.reduce((total, l) => total + l.salarialAmount, 0))}
                </Text>
              </View>
            </>
          ) : (
            <View style={styles.tableRow}>
              <Text style={styles.cellDesignation}>Cotisations sociales (estimation globale)</Text>
              <Text style={styles.cellValue}></Text>
              <Text style={styles.cellValue}>{formatEuro(estimatedContributions)}</Text>
            </View>
          )}
          {bonus > 0 && (
            <View style={styles.tableRow}>
              <Text style={styles.cellDesignation}>Prime(s)</Text>
              <Text style={styles.cellValue}>{formatEuro(bonus)}</Text>
              <Text style={styles.cellValue}></Text>
            </View>
          )}
          {mealVouchers > 0 && (
            <View style={styles.tableRow}>
              <Text style={styles.cellDesignation}>Panier(s) repas</Text>
              <Text style={styles.cellValue}>{formatEuro(mealVouchers)}</Text>
              <Text style={styles.cellValue}></Text>
            </View>
          )}
        </View>

        <View style={styles.netRow}>
          <View style={styles.netBox}>
            <Text style={styles.netLabel}>NET À PAYER</Text>
            <Text style={styles.netValue}>{formatEuro(totalNet)}</Text>
          </View>
        </View>

        <View style={styles.cumulRow}>
          <View style={styles.cumulBox}>
            <Text style={styles.cumulLabel}>CUMULS DEPUIS LE 1ER JANVIER</Text>
            <Text style={styles.cumulValue}>
              Brut : {formatEuro(data.cumulGrossYTD)} — Net : {formatEuro(data.cumulNetYTD)}
            </Text>
          </View>
        </View>

        <Text style={styles.disclaimer}>
          Document indicatif généré automatiquement à partir des données contractuelles enregistrées dans GODAC
          (salaire brut/net saisis par la direction).{" "}
          {data.contributionLines && data.contributionLines.length > 0
            ? "Le détail des cotisations ci-dessus reprend les taux saisis par la direction (à vérifier auprès de votre expert-comptable) — "
            : "Il ne détaille pas les cotisations ligne par ligne (URSSAF, retraite, prévoyance...), "}
          n&apos;intègre pas le prélèvement à la source personnalisé, et ne constitue ni un
          bulletin de paie officiel au sens de l&apos;article R3243-1 du code du travail, ni une déclaration sociale
          nominative (DSN). Les heures travaillées, congés pris et cumuls annuels affichés sont calculés à partir des
          données GODAC (pointeuse, congés, bulletins déjà générés) et n&apos;intègrent ni heures supplémentaires
          majorées, ni régularisations. À faire valider par votre expert-comptable ou votre logiciel de paie avant
          toute remise officielle au salarié.
        </Text>
      </Page>
    </Document>
  );
}

export async function generatePayslipPdf(data: PayslipPdfData): Promise<Buffer> {
  return renderToBuffer(<PayslipDocument data={data} />);
}
