import "server-only";
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
// Importer pdf.tsx enregistre aussi la police embarquée (NotoSans).
import { chargerLogo, themeBulletin, type LogoPdf } from "@/lib/paie/pdf";

/**
 * Documents de fin de contrat aux couleurs de GODAC (même charte que le
 * bulletin, lib/paie/pdf.tsx) : certificat de travail (art. D1234-6),
 * reçu pour solde de tout compte (art. L1234-20) et fiche de données pour
 * l'attestation employeur France Travail — l'attestation elle-même est
 * transmise par la DSN, GODAC ne la produit pas.
 */

const MARINE = "#0A0F1E";
const PAPER = "#F6F7FB";
const SURFACE = "#FFFFFF";
const TRAIT = "#D9DEE7";
const TEXTE_DOUX = "#4A5263";
const TEAL = "#1BE4C1";

const eur = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[  ]/g, " ");

export type TypeDocumentSortie = "certificat" | "solde" | "france-travail";

export interface DonneesDocumentSortie {
  employeur: { nom: string; adresse: string | null; siret: string | null; ape: string | null; urssaf?: string | null; convention: string | null; logoUrl?: string | null; accent?: string | null };
  salarie: { nom: string; adresse: string | null; secu: string | null; matricule: string | null; emploi: string | null; contrat: string | null };
  entree: string | null;
  sortie: string;
  motif: string;
  /** Emplois occupés (un par ligne). */
  emplois: string[];
  preavis: string;
  /** Sommes versées (solde de tout compte), brutes ou nettes selon le libellé. */
  sommes: { libelle: string; montant: number }[];
  netVerse: number;
  /** Le bulletin de sortie n'est pas encore généré : montants estimés. */
  estimation: boolean;
  /** 12 derniers mois de salaire (fiche France Travail). */
  salaires: { mois: string; brut: number; heures: number | null }[];
  indemnites: { libelle: string; montant: number }[];
  dateEdition: string;
  lieu: string | null;
}

function styles(accent: string, encre: string) {
  return StyleSheet.create({
    page: { paddingTop: 22, paddingHorizontal: 34, paddingBottom: 40, fontSize: 9, fontFamily: "NotoSans", color: MARINE, backgroundColor: SURFACE, lineHeight: 1.45 },
    bandeau: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: MARINE, borderRadius: 4, borderBottomWidth: 2.5, borderBottomColor: accent, paddingVertical: 8, paddingHorizontal: 12 },
    logoCadre: { backgroundColor: SURFACE, borderRadius: 3, paddingVertical: 3, paddingHorizontal: 6, maxWidth: 150 },
    logo: { height: 28, objectFit: "contain" },
    nomEntreprise: { fontSize: 13, color: SURFACE, maxWidth: 260 },
    titre: { fontSize: 12.5, color: SURFACE, letterSpacing: 1.4, textAlign: "right" },
    sousTitre: { fontSize: 8, color: accent, textAlign: "right", marginTop: 3 },
    cartouches: { flexDirection: "row", justifyContent: "space-between", marginTop: 10 },
    cartouche: { width: "49%", backgroundColor: PAPER, borderLeftWidth: 2, borderLeftColor: accent, borderRadius: 2, paddingVertical: 5, paddingHorizontal: 8 },
    etiquette: { fontSize: 7, color: encre, letterSpacing: 1, marginBottom: 1 },
    nom: { fontSize: 10.5, marginBottom: 1 },
    info: { fontSize: 8, color: TEXTE_DOUX },
    section: { marginTop: 14 },
    h2: { fontSize: 8, color: encre, letterSpacing: 1, borderBottomWidth: 0.5, borderBottomColor: accent, paddingBottom: 2, marginBottom: 5 },
    p: { marginBottom: 5 },
    table: { borderWidth: 0.75, borderColor: TRAIT, borderRadius: 2 },
    th: { flexDirection: "row", backgroundColor: MARINE },
    thCell: { color: SURFACE, fontSize: 7.5, paddingVertical: 3, paddingHorizontal: 5 },
    row: { flexDirection: "row", borderTopWidth: 0.5, borderTopColor: TRAIT },
    cell: { paddingVertical: 2.5, paddingHorizontal: 5, fontSize: 8.5 },
    num: { textAlign: "right" },
    total: { flexDirection: "row", borderTopWidth: 0.75, borderTopColor: MARINE, backgroundColor: "#ECEFF4" },
    alerte: { marginTop: 8, borderLeftWidth: 2, borderLeftColor: "#F59E0B", backgroundColor: "#FFF7E6", paddingVertical: 5, paddingHorizontal: 8, fontSize: 8 },
    mention: { borderLeftWidth: 2, borderLeftColor: accent, backgroundColor: PAPER, borderRadius: 2, paddingVertical: 6, paddingHorizontal: 8, fontSize: 8.5 },
    signatures: { flexDirection: "row", justifyContent: "space-between", marginTop: 24 },
    signature: { width: "45%", borderTopWidth: 0.5, borderTopColor: TRAIT, paddingTop: 4, fontSize: 8, color: TEXTE_DOUX, minHeight: 50 },
    footer: { position: "absolute", bottom: 16, left: 34, right: 34, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 0.5, borderTopColor: TRAIT, paddingTop: 4 },
    footerTexte: { fontSize: 6.5, color: TEXTE_DOUX },
    pastille: { width: 5, height: 5, borderRadius: 1, backgroundColor: TEAL, marginRight: 3 },
  });
}
type S = ReturnType<typeof styles>;

const TITRES: Record<TypeDocumentSortie, { titre: string; sous: string }> = {
  certificat: { titre: "CERTIFICAT DE TRAVAIL", sous: "Article D1234-6 du code du travail" },
  solde: { titre: "REÇU POUR SOLDE DE TOUT COMPTE", sous: "Article L1234-20 du code du travail" },
  "france-travail": { titre: "DONNÉES POUR L'ATTESTATION EMPLOYEUR", sous: "À transmettre par la DSN — document de travail, non officiel" },
};

function Tableau({ s, colonnes, lignes, total }: { s: S; colonnes: { titre: string; largeur: number; num?: boolean }[]; lignes: string[][]; total?: string[] }) {
  return (
    <View style={s.table}>
      <View style={s.th}>
        {colonnes.map((c) => (
          <Text key={c.titre} style={[s.thCell, { width: `${c.largeur}%` }, c.num ? s.num : {}]}>
            {c.titre}
          </Text>
        ))}
      </View>
      {lignes.map((l, i) => (
        <View key={i} style={s.row} wrap={false}>
          {l.map((x, j) => (
            <Text key={j} style={[s.cell, { width: `${colonnes[j]!.largeur}%` }, colonnes[j]!.num ? s.num : {}]}>
              {x}
            </Text>
          ))}
        </View>
      ))}
      {total && (
        <View style={s.total} wrap={false}>
          {total.map((x, j) => (
            <Text key={j} style={[s.cell, { width: `${colonnes[j]!.largeur}%` }, colonnes[j]!.num ? s.num : {}]}>
              {x}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

function DocumentSortie({ type, d, logo }: { type: TypeDocumentSortie; d: DonneesDocumentSortie; logo: LogoPdf | null }) {
  const t = themeBulletin(d.employeur.accent);
  const s = styles(t.accent, t.encre);
  const { titre, sous } = TITRES[type];
  const fait = `Fait${d.lieu ? ` à ${d.lieu}` : ""}, le ${d.dateEdition}.`;
  return (
    <Document title={`${titre.charAt(0)}${titre.slice(1).toLowerCase()} — ${d.salarie.nom}`} author={d.employeur.nom} creator="GODAC" producer="GODAC">
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
            <Text style={s.titre}>{titre}</Text>
            <Text style={s.sousTitre}>{sous}</Text>
          </View>
        </View>

        <View style={s.cartouches}>
          <View style={s.cartouche}>
            <Text style={s.etiquette}>EMPLOYEUR</Text>
            <Text style={s.nom}>{d.employeur.nom}</Text>
            {d.employeur.adresse && <Text style={s.info}>{d.employeur.adresse}</Text>}
            <Text style={s.info}>{[d.employeur.siret && `SIRET ${d.employeur.siret}`, d.employeur.ape && `APE ${d.employeur.ape}`].filter(Boolean).join(" · ") || "SIRET non renseigné"}</Text>
            {type === "france-travail" && d.employeur.urssaf && <Text style={s.info}>Urssaf : {d.employeur.urssaf}</Text>}
            <Text style={s.info}>Convention collective : {d.employeur.convention ?? "Transports routiers (IDCC 16)"}</Text>
          </View>
          <View style={s.cartouche}>
            <Text style={s.etiquette}>SALARIÉ</Text>
            <Text style={s.nom}>{d.salarie.nom}</Text>
            {d.salarie.adresse && <Text style={s.info}>{d.salarie.adresse}</Text>}
            {type !== "certificat" && d.salarie.secu && <Text style={s.info}>N° de Sécurité sociale : {d.salarie.secu}</Text>}
            {d.salarie.matricule && <Text style={s.info}>Matricule : {d.salarie.matricule}</Text>}
          </View>
        </View>

        {type === "certificat" && (
          <>
            <View style={s.section}>
              <Text style={s.p}>
                Je soussigné(e), représentant l&apos;entreprise {d.employeur.nom}, certifie que {d.salarie.nom} a été employé(e) du {d.entree ?? "(date d'entrée à compléter)"} au{" "}
                {d.sortie}.
              </Text>
            </View>
            <View style={s.section}>
              <Text style={s.h2}>EMPLOI(S) OCCUPÉ(S)</Text>
              {(d.emplois.length ? d.emplois : [d.salarie.emploi ?? "(à compléter)"]).map((e) => (
                <Text key={e} style={s.p}>
                  • {e}
                </Text>
              ))}
            </View>
            <View style={s.section}>
              <Text style={s.h2}>PORTABILITÉ DES GARANTIES SANTÉ ET PRÉVOYANCE</Text>
              <Text style={s.mention}>
                Le salarié bénéficie, s&apos;il est pris en charge par l&apos;assurance chômage, du maintien à titre gratuit des garanties collectives de
                complémentaire santé et de prévoyance en vigueur dans l&apos;entreprise, pendant une durée égale à celle de son dernier contrat de
                travail, dans la limite de 12 mois (art. L911-8 du code de la Sécurité sociale). Il doit justifier auprès de l&apos;organisme assureur de
                sa prise en charge par France Travail.
              </Text>
            </View>
            <View style={s.section}>
              <Text style={s.p}>Le salarié quitte l&apos;entreprise libre de tout engagement. Certificat remis pour servir et valoir ce que de droit.</Text>
              <Text>{fait}</Text>
            </View>
            <View style={s.signatures}>
              <Text style={s.signature}> </Text>
              <Text style={s.signature}>Pour l&apos;employeur — nom, qualité et signature</Text>
            </View>
          </>
        )}

        {type === "solde" && (
          <>
            <View style={s.section}>
              <Text style={s.p}>
                Je soussigné(e) {d.salarie.nom}, reconnais avoir reçu de l&apos;entreprise {d.employeur.nom}, pour solde de tout compte, en paiement des
                salaires, accessoires du salaire et indemnités de toute nature dus au titre de l&apos;exécution et de la cessation de mon contrat de
                travail (sortie le {d.sortie}, motif : {d.motif.toLowerCase()}), la somme nette de {eur(d.netVerse)} €, se décomposant comme suit :
              </Text>
            </View>
            <View style={s.section}>
              <Tableau
                s={s}
                colonnes={[
                  { titre: "Sommes versées", largeur: 70 },
                  { titre: "Montant (€)", largeur: 30, num: true },
                ]}
                lignes={d.sommes.map((x) => [x.libelle, eur(x.montant)])}
                total={["Net versé au salarié", eur(d.netVerse)]}
              />
              {d.estimation && <Text style={s.alerte}>Montants estimés : le bulletin de sortie n&apos;est pas encore généré. Régénérez ce reçu après le bulletin.</Text>}
            </View>
            <View style={s.section}>
              <Text style={s.mention}>
                Ce reçu, établi en double exemplaire dont un remis au salarié, peut être dénoncé dans les six mois qui suivent sa signature, par lettre
                recommandée. Passé ce délai, il devient libératoire pour l&apos;employeur pour les sommes qui y sont mentionnées (art. L1234-20 du code
                du travail).
              </Text>
            </View>
            <View style={s.section}>
              <Text>{fait}</Text>
            </View>
            <View style={s.signatures}>
              <Text style={s.signature}>Le salarié — signature précédée de la mention « Pour solde de tout compte »</Text>
              <Text style={s.signature}>Pour l&apos;employeur — nom, qualité et signature</Text>
            </View>
          </>
        )}

        {type === "france-travail" && (
          <>
            <Text style={s.alerte}>
              Document de travail : l&apos;attestation employeur destinée à France Travail est établie et transmise par la DSN (signalement de fin de
              contrat de travail). Cette fiche rassemble les données à y reporter ; elle ne la remplace pas.
            </Text>
            <View style={s.section}>
              <Text style={s.h2}>CONTRAT</Text>
              <Tableau
                s={s}
                colonnes={[
                  { titre: "Donnée", largeur: 45 },
                  { titre: "Valeur", largeur: 55 },
                ]}
                lignes={[
                  ["Date d'entrée", d.entree ?? "à compléter"],
                  ["Date de fin de contrat", d.sortie],
                  ["Motif de la rupture", d.motif],
                  ["Préavis", d.preavis],
                  ["Nature du contrat", d.salarie.contrat ?? "à compléter"],
                  ["Emploi", d.emplois[d.emplois.length - 1] ?? d.salarie.emploi ?? "à compléter"],
                ]}
              />
            </View>
            <View style={s.section}>
              <Text style={s.h2}>SALAIRES DES 12 DERNIERS MOIS (BULLETINS VALIDÉS)</Text>
              <Tableau
                s={s}
                colonnes={[
                  { titre: "Mois", largeur: 40 },
                  { titre: "Heures payées", largeur: 25, num: true },
                  { titre: "Salaire brut (€)", largeur: 35, num: true },
                ]}
                lignes={d.salaires.map((x) => [x.mois, x.heures === null ? "" : eur(x.heures), eur(x.brut)])}
                total={["Total", "", eur(d.salaires.reduce((t, x) => t + x.brut, 0))]}
              />
            </View>
            <View style={s.section}>
              <Text style={s.h2}>INDEMNITÉS DE FIN DE CONTRAT</Text>
              {d.indemnites.length ? (
                <Tableau
                  s={s}
                  colonnes={[
                    { titre: "Indemnité", largeur: 70 },
                    { titre: "Montant brut (€)", largeur: 30, num: true },
                  ]}
                  lignes={d.indemnites.map((x) => [x.libelle, eur(x.montant)])}
                />
              ) : (
                <Text style={s.info}>Aucune indemnité de fin de contrat.</Text>
              )}
              {d.estimation && <Text style={s.alerte}>Montants estimés : le bulletin de sortie n&apos;est pas encore généré.</Text>}
            </View>
          </>
        )}

        <View style={s.footer} fixed>
          <Text style={s.footerTexte}>
            {d.salarie.nom} · Édité le {d.dateEdition}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <View style={s.pastille} />
            <Text style={s.footerTexte}>Édité avec GODAC</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

export async function genererDocumentSortie(type: TypeDocumentSortie, d: DonneesDocumentSortie): Promise<Buffer> {
  const logo = await chargerLogo(d.employeur.logoUrl);
  return renderToBuffer(<DocumentSortie type={type} d={d} logo={logo} />);
}
