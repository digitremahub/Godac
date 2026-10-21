import "server-only";
import path from "node:path";
import { Document, Page, Text, View, Image, StyleSheet, Font, renderToBuffer, type Styles as ReactPdfStyles } from "@react-pdf/renderer";
import type { Bulletin, LigneBulletin, Section } from "@/lib/paie/types";

// Même police embarquée que lib/payslips/generate-pdf.tsx (voir son
// commentaire : les polices standard de pdfkit ne passent pas sur Vercel).
// Une seule graisse est fournie : la hiérarchie du bulletin repose sur la
// taille, les capitales et la couleur, pas sur le gras.
const notoSansPath = path.join(process.cwd(), "assets/fonts/NotoSans-Regular.ttf");
Font.register({
  family: "NotoSans",
  fonts: [
    { src: notoSansPath, fontWeight: 400 },
    { src: notoSansPath, fontWeight: 700 },
  ],
});

// ── Palette GODAC (tailwind.config.ts, app/globals.css) ──────────────
const MARINE = "#0A0F1E";
const TEAL = "#1BE4C1";
/** Teal lisible sur fond clair (--c-teal-ink). */
const TEAL_INK = "#0F766E";
const PAPER = "#F6F7FB";
const SURFACE = "#FFFFFF";
const TRAIT = "#D9DEE7";
const ZEBRE = "#F9FAFC";
const TEXTE_DOUX = "#4A5263";
/** Palette partagée avec le journal de paie et le registre du personnel (lib/paie/pdf-registres.tsx). */
export const PALETTE_PDF = { MARINE, TEAL, TEAL_INK, PAPER, SURFACE, TRAIT, ZEBRE, TEXTE_DOUX } as const;

/** Couleurs d'accent du bulletin : teal GODAC, ou la couleur de l'organisation. */
interface Theme {
  /** Aplats et liserés. */
  accent: string;
  /** Texte et bordures fortes sur fond clair (contraste ≥ 4,5:1 sur blanc). */
  encre: string;
  /** Fond très clair de l'encadré « Net payé ». */
  voile: string;
}

const hexVersRgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  const plein = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(plein.slice(i, i + 2), 16)) as [number, number, number];
};
const rgbVersHex = (rgb: number[]) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
const melange = (a: string, b: string, part: number) => {
  const [x, y] = [hexVersRgb(a), hexVersRgb(b)];
  return rgbVersHex(x.map((c, i) => c + (y[i]! - c) * part));
};
const luminance = (hex: string) => {
  const [r, g, b] = hexVersRgb(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrasteSurBlanc = (hex: string) => 1.05 / (luminance(hex) + 0.05);

export function themeBulletin(accentOrganisation?: string | null): Theme {
  if (!accentOrganisation || !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(accentOrganisation)) {
    return { accent: TEAL, encre: TEAL_INK, voile: "#E9FBF7" };
  }
  // Couleur de l'organisation : assombrie vers le marine pour le texte
  // jusqu'à un contraste suffisant (impression noir et blanc comprise).
  let encre = accentOrganisation;
  for (let part = 0.1; contrasteSurBlanc(encre) < 4.5 && part <= 1; part += 0.1) encre = melange(accentOrganisation, MARINE, part);
  return { accent: accentOrganisation, encre, voile: melange(accentOrganisation, "#FFFFFF", 0.9) };
}

/** Ordre des rubriques du bulletin clarifié. */
const ORDRE_SECTIONS: Section[] = ["brut", "sante", "at", "retraite", "famille", "chomage", "autres", "csg", "exonerations", "net"];
const SECTIONS_COTISATIONS: Section[] = ["sante", "at", "retraite", "famille", "chomage", "autres", "csg", "exonerations"];

const SECTION_LABEL: Record<Section, string> = {
  brut: "Rémunération",
  sante: "Santé",
  at: "Accidents du travail & maladies professionnelles",
  retraite: "Retraite",
  famille: "Famille",
  chomage: "Assurance chômage",
  autres: "Autres contributions dues par l'employeur",
  csg: "CSG / CRDS",
  exonerations: "Exonérations, écrêtements et allègements",
  net: "Indemnités non soumises, impôt et retenues",
};

/** fr-FR groupe les milliers avec U+202F, absent de la police embarquée. */
const eur = (n: number | null) =>
  n === null ? "" : n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[\u202f\u00a0]/g, " ");
const num = (n: number | null, digits = 2) =>
  n === null ? "" : n.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: digits }).replace(/[\u202f\u00a0]/g, " ");

export interface BulletinPdfData {
  bulletin: Bulletin;
  periode: string;
  /** Bornes de la période (JJ/MM/AAAA). */
  periodeDu?: string;
  periodeAu?: string;
  dateEdition: string;
  /** « Paiement le 30/09/2026 par virement ». */
  paiement?: string;
  employeur: {
    nom: string;
    adresse: string | null;
    siret: string | null;
    ape: string | null;
    urssaf: string | null;
    convention: string | null;
    /** organizations.logo_url (PNG ou JPEG) : affiché dans l'en-tête à la place du nom. */
    logoUrl?: string | null;
    /** organizations.accent_color : remplace le teal GODAC. */
    accent?: string | null;
  };
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

// Colonnes du tableau principal (en % de la largeur).
const C = { libelle: 36, base: 9.5, taux: 8.5, deduire: 11.5, payer: 11.5, tauxPat: 10, montantPat: 13 };
const pc = (n: number) => `${n}%`;

function styles(t: Theme) {
  return StyleSheet.create({
    page: { paddingTop: 18, paddingHorizontal: 24, paddingBottom: 30, fontSize: 7.2, fontFamily: "NotoSans", color: MARINE, backgroundColor: SURFACE },

    // En-tête : bandeau marine, liseré d'accent.
    bandeau: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: MARINE, borderRadius: 4, borderBottomWidth: 2.5, borderBottomColor: t.accent, paddingVertical: 7, paddingHorizontal: 12 },
    logoCadre: { backgroundColor: SURFACE, borderRadius: 3, paddingVertical: 3, paddingHorizontal: 6, maxWidth: 150 },
    logo: { height: 28, objectFit: "contain" },
    nomEntreprise: { fontSize: 13, color: SURFACE, maxWidth: 260 },
    titre: { fontSize: 12.5, color: SURFACE, letterSpacing: 1.6, textAlign: "right" },
    periode: { fontSize: 9.5, color: t.accent, textAlign: "right", marginTop: 1 },
    periodeBornes: { fontSize: 6.8, color: "#C5CBD6", textAlign: "right", marginTop: 1 },

    // Cartouches employeur / salarié.
    cartouches: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
    cartouche: { width: "49.3%", backgroundColor: PAPER, borderLeftWidth: 2, borderLeftColor: t.accent, borderRadius: 2, paddingVertical: 4, paddingHorizontal: 8 },
    etiquette: { fontSize: 6.2, color: t.encre, letterSpacing: 1, marginBottom: 1 },
    nom: { fontSize: 9.5, lineHeight: 1.25, marginBottom: 0.5 },
    ligneInfo: { fontSize: 6.9, color: TEXTE_DOUX, marginBottom: 0.3, lineHeight: 1.2 },

    // Tableau principal.
    table: { marginTop: 6, borderWidth: 0.75, borderColor: TRAIT, borderRadius: 2 },
    th: { flexDirection: "row", alignItems: "flex-end", backgroundColor: MARINE },
    thCell: { paddingHorizontal: 3, paddingVertical: 3, fontSize: 6.6, color: SURFACE, letterSpacing: 0.2 },
    thGroupe: { borderLeftWidth: 0.5, borderLeftColor: "#3A4256" },
    thGroupeTitre: { fontSize: 6.6, color: t.accent, textAlign: "center", paddingTop: 3, paddingBottom: 1.5, borderBottomWidth: 0.5, borderBottomColor: "#3A4256", letterSpacing: 0.4 },
    rubrique: { paddingTop: 2.4, paddingBottom: 0.6, paddingHorizontal: 3, borderBottomWidth: 0.5, borderBottomColor: t.accent },
    rubriqueTexte: { fontSize: 6.5, lineHeight: 1.15, color: t.encre, letterSpacing: 0.7 },
    row: { flexDirection: "row" },
    cell: { paddingVertical: 0.75, paddingHorizontal: 3, fontSize: 7.2, lineHeight: 1.15 },
    num: { textAlign: "right" },
    mention: { color: TEXTE_DOUX, fontSize: 6.3, lineHeight: 1.15 },
    total: { flexDirection: "row", backgroundColor: "#ECEFF4", borderTopWidth: 0.75, borderTopColor: MARINE },
    totalCell: { paddingVertical: 1.6, paddingHorizontal: 3, fontSize: 7.4, lineHeight: 1.15 },
    netAvantImpot: { flexDirection: "row", backgroundColor: t.voile, borderTopWidth: 0.75, borderTopColor: t.encre, borderBottomWidth: 0.75, borderBottomColor: t.encre },

    // Synthèse et net payé.
    synthese: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
    recap: { width: "68%", borderWidth: 0.75, borderColor: TRAIT, borderRadius: 2, paddingVertical: 4, paddingHorizontal: 8 },
    recapLigne: { flexDirection: "row", justifyContent: "space-between", marginBottom: 0.5 },
    recapSep: { borderTopWidth: 0.5, borderTopColor: TRAIT, marginVertical: 1.8 },
    recapTexte: { fontSize: 7.2, lineHeight: 1.2 },
    recapDoux: { color: TEXTE_DOUX, fontSize: 6.5, lineHeight: 1.2 },
    netCadre: { width: "30%", alignSelf: "flex-start", backgroundColor: t.voile, borderWidth: 1, borderColor: t.encre, borderRadius: 3, paddingVertical: 4, paddingHorizontal: 6, alignItems: "center" },
    netEtiquette: { fontSize: 7, color: t.encre, letterSpacing: 1.2 },
    netValeur: { fontSize: 15, color: MARINE, marginTop: 1 },
    netPaiement: { fontSize: 6.6, color: MARINE, marginTop: 2, textAlign: "center" },
    netDoux: { fontSize: 6.3, color: TEXTE_DOUX, textAlign: "center" },

    // Pied : cumuls, congés, mentions.
    pied: { marginTop: 6, borderWidth: 0.75, borderColor: TRAIT, borderRadius: 2 },
    piedTh: { flexDirection: "row", backgroundColor: PAPER, borderBottomWidth: 0.5, borderBottomColor: TRAIT },
    piedCell: { fontSize: 6.4, lineHeight: 1.15, paddingVertical: 1, paddingHorizontal: 2.5 },
    piedEntete: { color: TEXTE_DOUX },
    bas: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginTop: 6 },
    conges: { width: "37%", borderWidth: 0.75, borderColor: TRAIT, borderRadius: 2 },
    mentions: { borderLeftWidth: 2, borderLeftColor: t.accent, backgroundColor: PAPER, borderRadius: 2, paddingVertical: 4, paddingHorizontal: 8, justifyContent: "center" },
    mentionForte: { fontSize: 6.8, color: MARINE, lineHeight: 1.35, marginBottom: 2 },
    mentionDouce: { fontSize: 6.1, color: TEXTE_DOUX, lineHeight: 1.35 },

    // Pied de page.
    footer: { position: "absolute", bottom: 14, left: 24, right: 24, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 0.5, borderTopColor: TRAIT, paddingTop: 4 },
    footerTexte: { fontSize: 6, color: TEXTE_DOUX },
    signature: { flexDirection: "row", alignItems: "center" },
    signaturePastille: { width: 5, height: 5, borderRadius: 1, backgroundColor: TEAL, marginRight: 3 },
  });
}
type Styles = ReturnType<typeof styles>;
type Style = ReactPdfStyles[string];

/** Rangée de 7 cellules du tableau principal. */
function Rangee({ s, style, cells, cellStyle }: { s: Styles; style: Style | Style[]; cells: (string | React.ReactNode)[]; cellStyle?: Style }) {
  const largeurs = [C.libelle, C.base, C.taux, C.deduire, C.payer, C.tauxPat, C.montantPat];
  return (
    <View style={style} wrap={false}>
      {cells.map((c, i) => (
        <Text key={i} style={[cellStyle ?? s.cell, { width: pc(largeurs[i]!) }, i > 0 ? s.num : {}]}>
          {c}
        </Text>
      ))}
    </View>
  );
}

function Ligne({ s, l, zebre }: { s: Styles; l: LigneBulletin; zebre: boolean }) {
  const m = l.montantSalarial;
  // Gain négatif (congés pris, absence) : porté « à déduire ».
  const deduire = l.gain ? (m !== null && m < 0 ? eur(-m) : "") : eur(m);
  const payer = l.gain && m !== null && m >= 0 ? eur(m) : "";
  return (
    <Rangee
      s={s}
      style={[s.row, zebre ? { backgroundColor: ZEBRE } : {}]}
      cells={[
        l.mention ? (
          <>
            {l.libelle}
            <Text style={s.mention}>{`\n${l.mention}`}</Text>
          </>
        ) : (
          l.libelle
        ),
        num(l.base),
        l.gain ? eur(l.tauxSalarial) : num(l.tauxSalarial, 4),
        deduire,
        payer,
        num(l.tauxPatronal, 4),
        eur(l.montantPatronal),
      ]}
    />
  );
}

function EnTeteTableau({ s }: { s: Styles }) {
  const groupe = C.tauxPat + C.montantPat;
  return (
    <View style={s.th} fixed>
      <Text style={[s.thCell, { width: pc(C.libelle) }]}>Éléments de paie</Text>
      <Text style={[s.thCell, s.num, { width: pc(C.base) }]}>Base</Text>
      <Text style={[s.thCell, s.num, { width: pc(C.taux) }]}>Taux</Text>
      <Text style={[s.thCell, s.num, { width: pc(C.deduire) }]}>À déduire</Text>
      <Text style={[s.thCell, s.num, { width: pc(C.payer) }]}>À payer</Text>
      <View style={[s.thGroupe, { width: pc(groupe) }]}>
        <Text style={s.thGroupeTitre}>Charges patronales</Text>
        <View style={{ flexDirection: "row" }}>
          <Text style={[s.thCell, s.num, { width: pc((C.tauxPat / groupe) * 100) }]}>Taux</Text>
          <Text style={[s.thCell, s.num, { width: pc((C.montantPat / groupe) * 100) }]}>Montant</Text>
        </View>
      </View>
    </View>
  );
}

function Pied({ s, pied }: { s: Styles; pied: NonNullable<BulletinPdfData["pied"]> }) {
  const premiere = 12;
  const largeur = pc((100 - premiere) / Math.max(pied.totaux.length, 1));
  return (
    <View style={s.pied} wrap={false}>
      <View style={s.piedTh}>
        <Text style={[s.piedCell, s.piedEntete, { width: pc(premiere) }]}>Cumuls</Text>
        {pied.totaux.map((t) => (
          <Text key={t.libelle} style={[s.piedCell, s.piedEntete, s.num, { width: largeur }]}>{t.libelle}</Text>
        ))}
      </View>
      {(["mois", "annee"] as const).map((k, i) => (
        <View key={k} style={[s.row, i === 1 ? { backgroundColor: ZEBRE } : {}]}>
          <Text style={[s.piedCell, { width: pc(premiere) }]}>{k === "mois" ? "Mensuel" : "Annuel"}</Text>
          {pied.totaux.map((t) => (
            <Text key={t.libelle} style={[s.piedCell, s.num, { width: largeur }]}>{t.heures ? num(t[k]) : eur(t[k])}</Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function Conges({ s, conges }: { s: Styles; conges: NonNullable<NonNullable<BulletinPdfData["pied"]>["conges"]> }) {
  return (
    <View style={s.conges}>
      <View style={s.piedTh}>
        {["Congés payés", "Acquis", "Pris", "Solde"].map((h, i) => (
          <Text key={h} style={[s.piedCell, s.piedEntete, { width: i === 0 ? "34%" : "22%" }, i > 0 ? s.num : {}]}>{h}</Text>
        ))}
      </View>
      {([["N-1", conges.n1], ["N", conges.n]] as const).map(([l, c], i) => (
        <View key={l} style={[s.row, i === 1 ? { backgroundColor: ZEBRE } : {}]}>
          <Text style={[s.piedCell, { width: "34%" }]}>{l}</Text>
          <Text style={[s.piedCell, s.num, { width: "22%" }]}>{num(c.acquis)}</Text>
          <Text style={[s.piedCell, s.num, { width: "22%" }]}>{num(c.pris)}</Text>
          <Text style={[s.piedCell, s.num, { width: "22%" }]}>{num(c.solde)}</Text>
        </View>
      ))}
    </View>
  );
}

function RecapLigne({ s, libelle, montant, doux }: { s: Styles; libelle: string; montant: string; doux?: boolean }) {
  return (
    <View style={s.recapLigne}>
      <Text style={doux ? s.recapDoux : s.recapTexte}>{libelle}</Text>
      <Text style={doux ? s.recapDoux : s.recapTexte}>{montant}</Text>
    </View>
  );
}

export type LogoPdf = { data: Buffer; format: "png" | "jpg" };

function BulletinDoc({ d, logo }: { d: BulletinPdfData; logo: LogoPdf | null }) {
  const b = d.bulletin;
  const t = themeBulletin(d.employeur.accent);
  const s = styles(t);
  const presentes = ORDRE_SECTIONS.filter((sec) => b.lignes.some((l) => l.section === sec));
  const derniereCotisation = [...presentes].reverse().find((sec) => SECTIONS_COTISATIONS.includes(sec));
  const allegements = b.totalPatronalHorsReduction !== undefined ? Math.round((b.totalPatronalHorsReduction - b.totalPatronal) * 100) / 100 : b.reductionGenerale;
  const typeTaux = b.lignes.find((l) => l.section === "net" && l.libelle === "Impôt sur le revenu prélevé à la source")?.mention;
  const classification = [d.salarie.statut, d.salarie.groupe && `Groupe ${d.salarie.groupe}`, d.salarie.coefficient && `Coefficient ${d.salarie.coefficient}`].filter(Boolean).join(" · ");
  const identifiants = [d.salarie.matricule && `Matricule ${d.salarie.matricule}`, d.salarie.secu && `N° SS ${d.salarie.secu}`].filter(Boolean).join(" · ");
  const contrat = [d.salarie.contrat, d.salarie.entree && `Entrée le ${d.salarie.entree}`].filter(Boolean).join(" · ");

  return (
    <Document title={`Bulletin de paie — ${d.salarie.nom} — ${d.periode}`} author={d.employeur.nom} creator="GODAC" producer="GODAC">
      <Page size="A4" style={s.page}>
        <View style={s.bandeau}>
          {logo ? (
            <View style={s.logoCadre}>
              {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf : pas d'attribut alt */}
              <Image src={logo} style={s.logo} />
            </View>
          ) : (
            <Text style={s.nomEntreprise}>{d.employeur.nom}</Text>
          )}
          <View>
            <Text style={s.titre}>BULLETIN DE SALAIRE</Text>
            <Text style={s.periode}>{d.periode.charAt(0).toUpperCase() + d.periode.slice(1)}</Text>
            {d.periodeDu && d.periodeAu && <Text style={s.periodeBornes}>Période du {d.periodeDu} au {d.periodeAu}</Text>}
          </View>
        </View>

        <View style={s.cartouches}>
          <View style={s.cartouche}>
            <Text style={s.etiquette}>EMPLOYEUR</Text>
            <Text style={s.nom}>{d.employeur.nom}</Text>
            {d.employeur.adresse && <Text style={s.ligneInfo}>{d.employeur.adresse}</Text>}
            <Text style={s.ligneInfo}>{[d.employeur.siret && `SIRET ${d.employeur.siret}`, d.employeur.ape && `Code NAF (APE) ${d.employeur.ape}`].filter(Boolean).join(" · ") || "SIRET non renseigné"}</Text>
            {d.employeur.urssaf && <Text style={s.ligneInfo}>Urssaf : {d.employeur.urssaf}</Text>}
            <Text style={s.ligneInfo}>Convention collective : {d.employeur.convention ?? "Transports routiers et activités auxiliaires du transport (IDCC 16)"}</Text>
          </View>
          <View style={s.cartouche}>
            <Text style={s.etiquette}>SALARIÉ</Text>
            <Text style={s.nom}>{d.salarie.nom}</Text>
            {d.salarie.adresse && <Text style={s.ligneInfo}>{d.salarie.adresse}</Text>}
            {d.salarie.emploi && <Text style={s.ligneInfo}>Emploi : {d.salarie.emploi}</Text>}
            <Text style={s.ligneInfo}>Statut : {classification}</Text>
            {(contrat || identifiants) && <Text style={s.ligneInfo}>{[contrat, identifiants].filter(Boolean).join(" · ")}</Text>}
          </View>
        </View>

        <View style={s.table}>
          <EnTeteTableau s={s} />
          {presentes.map((sec) => {
            const lignes = b.lignes.filter((l) => l.section === sec);
            return (
              <View key={sec}>
                <View style={s.rubrique} wrap={false}>
                  <Text style={s.rubriqueTexte}>{SECTION_LABEL[sec].toUpperCase()}</Text>
                </View>
                {lignes.map((l, i) => (
                  <Ligne key={i} s={s} l={l} zebre={i % 2 === 1} />
                ))}
                {sec === "brut" && <Rangee s={s} style={s.total} cellStyle={s.totalCell} cells={["Salaire brut", "", "", "", eur(b.brut), "", ""]} />}
                {sec === derniereCotisation && (
                  <>
                    <Rangee s={s} style={s.total} cellStyle={s.totalCell} cells={["Total des cotisations et contributions", "", "", eur(b.totalSalarial), "", "", eur(b.totalPatronal)]} />
                    <Rangee s={s} style={s.netAvantImpot} cellStyle={s.totalCell} cells={["Salaire net après cotisations", "", "", "", eur(b.netAvantImpot), "", ""]} />
                  </>
                )}
              </View>
            );
          })}
        </View>

        <View style={s.synthese} wrap={false}>
          <View style={s.recap}>
            {/* Ordre du bulletin clarifié : le « net à payer avant impôt » est ce
                qui serait versé sans le prélèvement à la source (indemnités
                non soumises ajoutées, acomptes et saisies déduits). */}
            <RecapLigne s={s} libelle="Salaire net après cotisations" montant={`${eur(b.netAvantImpot)} €`} />
            {b.fraisNonSoumis > 0 && <RecapLigne s={s} libelle="Indemnités et frais non soumis" montant={`+ ${eur(b.fraisNonSoumis)} €`} />}
            {(b.totalRetenues ?? 0) > 0 && <RecapLigne s={s} libelle="Acomptes et saisies (détail ci-dessus)" montant={`− ${eur(b.totalRetenues)} €`} />}
            <RecapLigne s={s} libelle="Net à payer avant impôt sur le revenu" montant={`${eur(b.netAPayer + b.montantPas)} €`} />
            <RecapLigne
              s={s}
              libelle={`Impôt sur le revenu prélevé à la source${typeTaux ? ` (${typeTaux.toLowerCase()}, ${num(b.tauxPas)} %)` : ` (${num(b.tauxPas)} %)`}`}
              montant={`− ${eur(b.montantPas)} €`}
            />
            <View style={s.recapSep} />
            <RecapLigne s={s} libelle="Montant net social" montant={`${eur(b.netSocial)} €`} />
            <RecapLigne s={s} libelle="Net imposable" montant={`${eur(b.netImposable)} €`} />
            {(b.reintegrationSante ?? 0) > 0 && <RecapLigne s={s} doux libelle="dont réintégration fiscale santé (part employeur)" montant={`${eur(b.reintegrationSante ?? 0)} €`} />}
            {b.heuresSupExonerees > 0 && <RecapLigne s={s} doux libelle="Heures supplémentaires exonérées d'impôt" montant={`${eur(b.heuresSupExonerees)} €`} />}
            <RecapLigne s={s} libelle="Allègements de cotisations employeur" montant={`${eur(allegements)} €`} />
            <RecapLigne s={s} libelle="Total versé par l'employeur (coût total)" montant={`${eur(b.coutEmployeur)} €`} />
          </View>
          <View style={s.netCadre}>
            <Text style={s.netEtiquette}>NET PAYÉ</Text>
            <Text style={s.netValeur}>{eur(b.netAPayer)} €</Text>
            <Text style={s.netDoux}>en euros</Text>
            {d.paiement && <Text style={s.netPaiement}>{d.paiement}</Text>}
          </View>
        </View>

        {d.pied && <Pied s={s} pied={d.pied} />}

        <View style={s.bas} wrap={false}>
          {d.pied?.conges && <Conges s={s} conges={d.pied.conges} />}
          <View style={[s.mentions, { width: d.pied?.conges ? "61.5%" : "100%" }]}>
            <Text style={s.mentionForte}>
              Dans votre intérêt et pour vous aider à faire valoir vos droits, conservez ce bulletin de paie sans limitation de durée. Informations
              complémentaires : www.service-public.fr
            </Text>
            <Text style={s.mentionDouce}>
              Cotisations sociales : www.urssaf.fr · Retraite : www.info-retraite.fr. Bulletin calculé à partir des paramètres légaux en vigueur et
              des réglages de l&apos;entreprise ; l&apos;employeur reste responsable de son exactitude.
            </Text>
          </View>
        </View>

        <View style={s.footer} fixed>
          <Text style={s.footerTexte}>
            {d.salarie.nom} · {d.periode} · Édité le {d.dateEdition}
          </Text>
          <Text style={s.footerTexte} render={({ pageNumber, totalPages }) => (totalPages > 1 ? `Page ${pageNumber} / ${totalPages}` : "")} />
          <View style={s.signature}>
            <View style={s.signaturePastille} />
            <Text style={s.footerTexte}>Édité avec GODAC</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

/**
 * Logo de l'organisation pour l'en-tête : PNG ou JPEG seulement (formats
 * lus par react-pdf), téléchargé avec un délai court. En cas d'échec, le
 * bulletin affiche le nom de l'entreprise.
 */
export async function chargerLogo(url: string | null | undefined): Promise<LogoPdf | null> {
  if (!url || !/^https:\/\//.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > 2_000_000) return null;
    if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return { data, format: "png" };
    if (data[0] === 0xff && data[1] === 0xd8) return { data, format: "jpg" };
    return null;
  } catch {
    return null;
  }
}

export async function genererBulletinPdf(d: BulletinPdfData, options: { logo?: LogoPdf | null } = {}): Promise<Buffer> {
  const logo = options.logo !== undefined ? options.logo : await chargerLogo(d.employeur.logoUrl);
  return renderToBuffer(<BulletinDoc d={d} logo={logo} />);
}
