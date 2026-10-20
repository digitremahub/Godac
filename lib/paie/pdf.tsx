import "server-only";
import path from "node:path";
import { Document, Page, Text, View, StyleSheet, Font, renderToBuffer } from "@react-pdf/renderer";
import type { Bulletin, LigneBulletin, Section } from "@/lib/paie/types";

// Même police embarquée que lib/payslips/generate-pdf.tsx (voir son
// commentaire : les polices standard de pdfkit ne passent pas sur Vercel).
const notoSansPath = path.join(process.cwd(), "assets/fonts/NotoSans-Regular.ttf");
Font.register({
  family: "NotoSans",
  fonts: [
    { src: notoSansPath, fontWeight: 400 },
    { src: notoSansPath, fontWeight: 700 },
  ],
});

const INK = "#0A0F1E";
const s = StyleSheet.create({
  page: { padding: 22, fontSize: 8, fontFamily: "NotoSans", color: INK },
  head: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  box: { width: "48.5%", borderWidth: 1, borderColor: "#B8BEC9", borderRadius: 3, padding: 6 },
  strong: { fontSize: 9.5, fontWeight: 700, marginBottom: 2 },
  line: { fontSize: 7.5, color: "#333", marginBottom: 1 },
  title: { fontSize: 14, fontWeight: 700, marginBottom: 1 },
  table: { borderWidth: 1, borderColor: "#B8BEC9", marginTop: 6 },
  th: { flexDirection: "row", backgroundColor: INK, color: "#FFFFFF" },
  thCell: { padding: 3.5, fontSize: 7, fontWeight: 700 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#E1E4EA" },
  sectionRow: { flexDirection: "row", backgroundColor: "#EEF1F5" },
  sectionCell: { paddingVertical: 1.5, paddingHorizontal: 3, fontSize: 7, fontWeight: 700 },
  totalRow: { flexDirection: "row", backgroundColor: "#F6F7FB", borderTopWidth: 1, borderTopColor: "#B8BEC9" },
  cLabel: { width: "34%", paddingVertical: 1.1, paddingHorizontal: 3, fontSize: 7 },
  cNum: { width: "11%", paddingVertical: 1.1, paddingHorizontal: 3, fontSize: 7, textAlign: "right" },
  netWrap: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  infoBox: { width: "58%", borderWidth: 1, borderColor: "#B8BEC9", borderRadius: 3, padding: 7 },
  infoLine: { flexDirection: "row", justifyContent: "space-between", fontSize: 7.2, marginBottom: 1 },
  netBox: { width: "38%", borderWidth: 2, borderColor: "#1BE4C1", borderRadius: 4, padding: 8, alignItems: "center", justifyContent: "center" },
  netLabel: { fontSize: 8.5, fontWeight: 700 },
  netValue: { fontSize: 17, fontWeight: 700, marginTop: 2 },
  footer: { position: "absolute", bottom: 12, left: 22, right: 22, fontSize: 6.4, color: "#555", lineHeight: 1.3 },
});

const SECTION_LABEL: Record<Section, string> = {
  brut: "Rémunération",
  sante: "Santé",
  retraite: "Retraite",
  famille: "Famille",
  chomage: "Assurance chômage",
  autres: "Autres contributions dues par l'employeur",
  csg: "CSG / CRDS",
  exonerations: "Exonérations, écrêtements et allègements",
  net: "Après le net imposable",
};

/** fr-FR groupe les milliers avec U+202F, absent de la police embarquée. */
const eur = (n: number | null) =>
  n === null ? "" : n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[  ]/g, " ");
const num = (n: number | null, digits = 2) =>
  n === null ? "" : n.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: digits }).replace(/[  ]/g, " ");

export interface BulletinPdfData {
  bulletin: Bulletin;
  periode: string;
  dateEdition: string;
  employeur: { nom: string; adresse: string | null; siret: string | null; ape: string | null; urssaf: string | null; convention: string | null };
  salarie: {
    nom: string;
    adresse: string | null;
    emploi: string | null;
    matricule: string | null;
    secu: string | null;
    coefficient: string | null;
    groupe?: string | null;
    statut: string;
    entree: string | null;
    contrat: string | null;
  };
  cumuls: { brut: number; netImposable: number; heuresSupExonerees: number };
  conges: { pris: number };
  /** Pied de bulletin : totaux du mois et de l'année, compteurs de congés N-1 / N. */
  pied?: {
    totaux: { libelle: string; mois: number; annee: number; heures?: boolean }[];
    conges: { n1: { acquis: number; pris: number; solde: number }; n: { acquis: number; pris: number; solde: number } } | null;
  };
}

const sp = StyleSheet.create({
  wrap: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  box: { borderWidth: 1, borderColor: "#B8BEC9", borderRadius: 3, padding: 5 },
  row: { flexDirection: "row" },
  th: { fontSize: 6.6, fontWeight: 700, paddingVertical: 1, paddingHorizontal: 2 },
  td: { fontSize: 6.6, paddingVertical: 0.8, paddingHorizontal: 2 },
});

function Pied({ pied }: { pied: NonNullable<BulletinPdfData["pied"]> }) {
  const largeur = `${Math.floor(78 / Math.max(pied.totaux.length, 1))}%`;
  return (
    <View style={sp.wrap} wrap={false}>
      <View style={[sp.box, { width: pied.conges ? "70%" : "100%" }]}>
        <View style={sp.row}>
          <Text style={[sp.th, { width: "22%" }]}>Totaux</Text>
          {pied.totaux.map((t) => (
            <Text key={t.libelle} style={[sp.th, { width: largeur, textAlign: "right" }]}>{t.libelle}</Text>
          ))}
        </View>
        {(["mois", "annee"] as const).map((k) => (
          <View key={k} style={sp.row}>
            <Text style={[sp.td, { width: "22%" }]}>{k === "mois" ? "Mois" : "Année"}</Text>
            {pied.totaux.map((t) => (
              <Text key={t.libelle} style={[sp.td, { width: largeur, textAlign: "right" }]}>{t.heures ? num(t[k]) : eur(t[k])}</Text>
            ))}
          </View>
        ))}
      </View>
      {pied.conges && (
        <View style={[sp.box, { width: "28.5%" }]}>
          <View style={sp.row}>
            {["Congés", "Acquis", "Pris", "Solde"].map((h) => (
              <Text key={h} style={[sp.th, { width: "25%", textAlign: h === "Congés" ? "left" : "right" }]}>{h}</Text>
            ))}
          </View>
          {([["N-1", pied.conges.n1], ["N", pied.conges.n]] as const).map(([l, c]) => (
            <View key={l} style={sp.row}>
              <Text style={[sp.td, { width: "25%" }]}>{l}</Text>
              <Text style={[sp.td, { width: "25%", textAlign: "right" }]}>{num(c.acquis)}</Text>
              <Text style={[sp.td, { width: "25%", textAlign: "right" }]}>{num(c.pris)}</Text>
              <Text style={[sp.td, { width: "25%", textAlign: "right" }]}>{num(c.solde)}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function Ligne({ l }: { l: LigneBulletin }) {
  return (
    <View style={s.row} wrap={false}>
      <Text style={s.cLabel}>{l.libelle}</Text>
      <Text style={s.cNum}>{num(l.base)}</Text>
      <Text style={s.cNum}>{l.gain ? eur(l.tauxSalarial) : num(l.tauxSalarial, 4)}</Text>
      <Text style={s.cNum}>{l.gain ? "" : eur(l.montantSalarial)}</Text>
      <Text style={s.cNum}>{l.gain ? eur(l.montantSalarial) : ""}</Text>
      <Text style={s.cNum}>{num(l.tauxPatronal, 4)}</Text>
      <Text style={s.cNum}>{eur(l.montantPatronal)}</Text>
    </View>
  );
}

function BulletinDoc({ d }: { d: BulletinPdfData }) {
  const b = d.bulletin;
  const sections = Array.from(new Set(b.lignes.map((l) => l.section)));
  return (
    <Document title={`Bulletin de paie — ${d.salarie.nom} — ${d.periode}`} author={d.employeur.nom}>
      <Page size="A4" style={s.page}>
        <View style={s.head}>
          <View style={s.box}>
            <Text style={s.strong}>{d.employeur.nom}</Text>
            {d.employeur.adresse && <Text style={s.line}>{d.employeur.adresse}</Text>}
            {d.employeur.siret && <Text style={s.line}>SIRET : {d.employeur.siret}</Text>}
            {d.employeur.ape && <Text style={s.line}>Code APE : {d.employeur.ape}</Text>}
            {d.employeur.urssaf && <Text style={s.line}>URSSAF : {d.employeur.urssaf}</Text>}
            <Text style={s.line}>Convention : {d.employeur.convention ?? "Transports routiers et activités auxiliaires (IDCC 16)"}</Text>
          </View>
          <View style={s.box}>
            <Text style={s.title}>Bulletin de paie</Text>
            <Text style={s.line}>Période : {d.periode} · Édité le {d.dateEdition}</Text>
            <Text style={[s.strong, { marginTop: 4 }]}>{d.salarie.nom}</Text>
            {d.salarie.adresse && <Text style={s.line}>{d.salarie.adresse}</Text>}
            <Text style={s.line}>
              {[d.salarie.emploi, d.salarie.statut, d.salarie.groupe && `Groupe ${d.salarie.groupe}`, d.salarie.coefficient && `Coef. ${d.salarie.coefficient}`].filter(Boolean).join(" · ")}
            </Text>
            <Text style={s.line}>
              {[d.salarie.matricule && `Matricule ${d.salarie.matricule}`, d.salarie.secu && `N° SS ${d.salarie.secu}`].filter(Boolean).join(" · ")}
            </Text>
            <Text style={s.line}>{[d.salarie.contrat, d.salarie.entree && `Entrée le ${d.salarie.entree}`].filter(Boolean).join(" · ")}</Text>
          </View>
        </View>

        <View style={s.table}>
          <View style={s.th} fixed>
            <Text style={[s.thCell, { width: "34%" }]}>Rubrique</Text>
            <Text style={[s.thCell, { width: "11%", textAlign: "right" }]}>Base</Text>
            <Text style={[s.thCell, { width: "11%", textAlign: "right" }]}>Taux sal.</Text>
            <Text style={[s.thCell, { width: "11%", textAlign: "right" }]}>Retenue</Text>
            <Text style={[s.thCell, { width: "11%", textAlign: "right" }]}>Gain</Text>
            <Text style={[s.thCell, { width: "11%", textAlign: "right" }]}>Taux pat.</Text>
            <Text style={[s.thCell, { width: "11%", textAlign: "right" }]}>Part pat.</Text>
          </View>
          {sections.map((sec) => (
            <View key={sec}>
              <View style={s.sectionRow}>
                <Text style={s.sectionCell}>{SECTION_LABEL[sec]}</Text>
              </View>
              {b.lignes.filter((l) => l.section === sec).map((l, i) => (
                <Ligne key={i} l={l} />
              ))}
              {sec === "brut" && (
                <View style={s.totalRow}>
                  <Text style={[s.cLabel, { fontWeight: 700 }]}>Salaire brut</Text>
                  <Text style={s.cNum} />
                  <Text style={s.cNum} />
                  <Text style={s.cNum} />
                  <Text style={[s.cNum, { fontWeight: 700 }]}>{eur(b.brut)}</Text>
                  <Text style={s.cNum} />
                  <Text style={s.cNum} />
                </View>
              )}
              {sec === "exonerations" && (
                <View style={s.totalRow}>
                  <Text style={[s.cLabel, { fontWeight: 700 }]}>Total des cotisations et contributions</Text>
                  <Text style={s.cNum} />
                  <Text style={s.cNum} />
                  <Text style={[s.cNum, { fontWeight: 700 }]}>{eur(b.totalSalarial)}</Text>
                  <Text style={s.cNum} />
                  <Text style={s.cNum} />
                  <Text style={[s.cNum, { fontWeight: 700 }]}>{eur(b.totalPatronal)}</Text>
                </View>
              )}
            </View>
          ))}
        </View>

        <View style={s.netWrap} wrap={false}>
          <View style={s.infoBox}>
            <View style={s.infoLine}><Text>Net à payer avant impôt sur le revenu</Text><Text>{eur(b.netAvantImpot)} €</Text></View>
            <View style={s.infoLine}><Text>Montant net social</Text><Text>{eur(b.netSocial)} €</Text></View>
            <View style={s.infoLine}><Text>Net imposable</Text><Text>{eur(b.netImposable)} €</Text></View>
            <View style={s.infoLine}><Text>Impôt sur le revenu (taux {num(b.tauxPas)} %)</Text><Text>− {eur(b.montantPas)} €</Text></View>
            {(b.reintegrationSante ?? 0) > 0 && <View style={s.infoLine}><Text>dont réintégration fiscale santé (part employeur)</Text><Text>{eur(b.reintegrationSante ?? 0)} €</Text></View>}
            {b.fraisNonSoumis > 0 && <View style={s.infoLine}><Text>Frais et indemnités non soumis</Text><Text>+ {eur(b.fraisNonSoumis)} €</Text></View>}
            {b.totalDu !== undefined && <View style={s.infoLine}><Text>Total dû (net + indemnités non soumises)</Text><Text>{eur(b.totalDu)} €</Text></View>}
            {(b.totalRetenues ?? 0) > 0 && <View style={s.infoLine}><Text>Acomptes et saisies (détail ci-dessus)</Text><Text>− {eur(b.totalRetenues)} €</Text></View>}
            {b.heuresSupExonerees > 0 && <View style={s.infoLine}><Text>Heures supplémentaires exonérées d'impôt</Text><Text>{eur(b.heuresSupExonerees)} €</Text></View>}
            <View style={s.infoLine}><Text>Total versé par l'employeur</Text><Text>{eur(b.coutEmployeur)} €</Text></View>
            <View style={[s.infoLine, { marginTop: 4 }]}><Text>Cumul brut de l'année</Text><Text>{eur(d.cumuls.brut)} €</Text></View>
            <View style={s.infoLine}><Text>Cumul net imposable de l'année</Text><Text>{eur(d.cumuls.netImposable)} €</Text></View>
            <View style={s.infoLine}><Text>Heures : base {num(b.heures.base)} · sup. 25 % {num(b.heures.sup25)} · sup. 50 % {num(b.heures.sup50)}</Text><Text>Congés pris : {num(d.conges.pris)} j</Text></View>
          </View>
          <View style={s.netBox}>
            <Text style={s.netLabel}>Net à payer</Text>
            <Text style={s.netValue}>{eur(b.netAPayer)} €</Text>
          </View>
        </View>
        {d.pied && <Pied pied={d.pied} />}

        <Text style={s.footer} fixed>
          Dans votre intérêt et pour vous aider à faire valoir vos droits, conservez ce bulletin de paie sans limitation de durée.
          Pour plus d'informations sur les cotisations sociales : www.info-retraite.fr et www.urssaf.fr. Bulletin calculé par GODAC à
          partir des paramètres légaux en vigueur et des réglages de l'entreprise ; l'employeur reste responsable de son exactitude.
        </Text>
      </Page>
    </Document>
  );
}

export async function genererBulletinPdf(d: BulletinPdfData): Promise<Buffer> {
  return renderToBuffer(<BulletinDoc d={d} />);
}
