import "server-only";
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
// Importer lib/paie/pdf.tsx déclare aussi la police NotoSans embarquée
// (voir next.config.mjs : assets/fonts tracés pour les routes PDF).
import { chargerLogo, PALETTE_PDF, themeBulletin, type LogoPdf } from "@/lib/paie/pdf";
import type { IdentitesBulletin } from "@/lib/paie/rendu-bulletin";
import { RUBRIQUES, libelleStatut, type LigneJournal, type Part, type TotauxJournal } from "@/lib/paie/journal";
import { champsManquants, libelleContrat, partiesRegistre, SEXES, titreTravail, type EntreeRegistre } from "@/lib/registre/personnel";
import { dateFr } from "@/lib/paie/csv";
import { MENTION_INDICATIVE } from "@/lib/legal/mention-indicative";

const { MARINE, PAPER, SURFACE, TRAIT, ZEBRE, TEXTE_DOUX } = PALETTE_PDF;
const ORANGE = "#B45309";

/** fr-FR groupe les milliers avec U+202F, absent de la police embarquée. */
const eur = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[  ]/g, " ");

type Organisation = IdentitesBulletin["organisation"];

function styles(accent: string | null | undefined) {
  const t = themeBulletin(accent);
  return {
    t,
    s: StyleSheet.create({
      page: { paddingTop: 18, paddingHorizontal: 22, paddingBottom: 30, fontSize: 6.4, fontFamily: "NotoSans", color: MARINE, backgroundColor: SURFACE },
      bandeau: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: MARINE, borderRadius: 4, borderBottomWidth: 2.5, borderBottomColor: t.accent, paddingVertical: 7, paddingHorizontal: 12 },
      logoCadre: { backgroundColor: SURFACE, borderRadius: 3, paddingVertical: 3, paddingHorizontal: 6, maxWidth: 150 },
      logo: { height: 26, objectFit: "contain" },
      nomEntreprise: { fontSize: 12, color: SURFACE, maxWidth: 360 },
      titre: { fontSize: 12, color: SURFACE, letterSpacing: 1.6, textAlign: "right" },
      periode: { fontSize: 9, color: t.accent, textAlign: "right", marginTop: 1 },
      cartouche: { marginTop: 6, backgroundColor: PAPER, borderLeftWidth: 2, borderLeftColor: t.accent, borderRadius: 2, paddingVertical: 4, paddingHorizontal: 8 },
      ligneInfo: { fontSize: 6.8, color: TEXTE_DOUX, lineHeight: 1.3 },
      table: { marginTop: 6, borderWidth: 0.75, borderColor: TRAIT, borderRadius: 2 },
      th: { flexDirection: "row", alignItems: "flex-end", backgroundColor: MARINE },
      thCell: { paddingHorizontal: 2.5, paddingVertical: 3, fontSize: 5.9, color: SURFACE },
      row: { flexDirection: "row", borderBottomWidth: 0.4, borderBottomColor: TRAIT },
      cell: { paddingVertical: 1.6, paddingHorizontal: 2.5, fontSize: 6.2, lineHeight: 1.2 },
      num: { textAlign: "right" },
      doux: { color: TEXTE_DOUX, fontSize: 5.6 },
      alerte: { color: ORANGE, fontSize: 5.6 },
      total: { flexDirection: "row", backgroundColor: t.voile, borderTopWidth: 0.75, borderTopColor: t.encre },
      synthese: { flexDirection: "row", flexWrap: "wrap", marginTop: 8 },
      tuile: { width: "16%", marginRight: "0.8%", backgroundColor: PAPER, borderLeftWidth: 2, borderLeftColor: t.accent, borderRadius: 2, paddingVertical: 4, paddingHorizontal: 6 },
      tuileEtiquette: { fontSize: 5.8, color: t.encre, letterSpacing: 0.6 },
      tuileValeur: { fontSize: 10, marginTop: 1 },
      note: { marginTop: 6, fontSize: 6.2, color: TEXTE_DOUX, lineHeight: 1.35 },
      footer: { position: "absolute", bottom: 12, left: 22, right: 22, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 0.5, borderTopColor: TRAIT, paddingTop: 4 },
      footerTexte: { fontSize: 6, color: TEXTE_DOUX },
    }),
  };
}
type S = ReturnType<typeof styles>["s"];

function Bandeau({ s, organisation, logo, titre, sousTitre }: { s: S; organisation: Organisation; logo: LogoPdf | null; titre: string; sousTitre: string }) {
  return (
    <View style={s.bandeau} fixed>
      {logo ? (
        <View style={s.logoCadre}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf : pas d'attribut alt */}
          <Image style={s.logo} src={{ data: logo.data, format: logo.format }} />
        </View>
      ) : (
        <Text style={s.nomEntreprise}>{organisation?.name ?? "Entreprise"}</Text>
      )}
      <View>
        <Text style={s.titre}>{titre}</Text>
        <Text style={s.periode}>{sousTitre}</Text>
      </View>
    </View>
  );
}

function Employeur({ s, organisation }: { s: S; organisation: Organisation }) {
  const infos = [
    organisation?.name,
    organisation?.legal_address,
    organisation?.siret && `SIRET ${organisation.siret}`,
    organisation?.ape_code && `APE ${organisation.ape_code}`,
    organisation?.urssaf_number && `URSSAF ${organisation.urssaf_number}`,
    organisation?.convention_collective,
  ].filter(Boolean);
  return (
    <View style={s.cartouche}>
      <Text style={s.ligneInfo}>{infos.join(" · ")}</Text>
    </View>
  );
}

function PiedDePage({ s, texte }: { s: S; texte: string }) {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footerTexte}>{texte}</Text>
      <Text style={s.footerTexte} render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`} />
      <Text style={s.footerTexte}>Édité avec GODAC</Text>
    </View>
  );
}

// ── Journal de paie ────────────────────────────────────────────────

const J = { nom: 11.2, brut: 5.6, rubrique: 4.9, total: 5.2, autre: 4.8 };
const pc = (n: number) => `${n}%`;
const COLONNES_FIN = ["Net social", "Net imposable", "PAS", "Frais", "Retenues", "Net payé", "Coût total"] as const;

function partTexte(p: Part) {
  return `${eur(p.salarial)}\n${eur(p.patronal)}`;
}

function LigneJ({ s, l, zebre, total }: { s: S; l: Omit<LigneJournal, "userId" | "matricule" | "statut"> & { sousTitre?: string; alerte?: boolean }; zebre: boolean; total?: boolean }) {
  const fin = [l.netSocial, l.netImposable, l.montantPas, l.frais, l.retenues, l.netPaye, l.coutTotal];
  return (
    <View style={[total ? s.total : s.row, zebre ? { backgroundColor: ZEBRE } : {}]} wrap={false}>
      <View style={[s.cell, { width: pc(J.nom) }]}>
        <Text>{l.nom}</Text>
        {l.sousTitre && <Text style={l.alerte ? s.alerte : s.doux}>{l.sousTitre}</Text>}
      </View>
      <Text style={[s.cell, s.num, { width: pc(J.brut) }]}>{eur(l.brut)}</Text>
      {RUBRIQUES.map((r) => (
        <Text key={r.id} style={[s.cell, s.num, { width: pc(J.rubrique) }]}>
          {partTexte(l.rubriques[r.id])}
        </Text>
      ))}
      <Text style={[s.cell, s.num, { width: pc(J.total) }]}>{eur(l.totalSalarial)}</Text>
      <Text style={[s.cell, s.num, { width: pc(J.total) }]}>{eur(l.totalPatronal)}</Text>
      {fin.map((v, i) => (
        <Text key={i} style={[s.cell, s.num, { width: pc(J.autre) }]}>
          {eur(v)}
        </Text>
      ))}
    </View>
  );
}

export interface JournalPdfData {
  libelleMois: string;
  organisation: Organisation;
  lignes: LigneJournal[];
  totaux: TotauxJournal;
  dateEdition: string;
}

function JournalDoc({ d, logo }: { d: JournalPdfData; logo: LogoPdf | null }) {
  const { s } = styles(d.organisation?.accent_color);
  const tuiles: [string, number | string][] = [
    ["MASSE SALARIALE BRUTE", eur(d.totaux.brut)],
    ["COTISATIONS SALARIALES", eur(d.totaux.totalSalarial)],
    ["CHARGES PATRONALES", eur(d.totaux.totalPatronal)],
    ["DONT RÉDUCTION GÉNÉRALE", eur(-d.totaux.reductionGenerale)],
    ["NETS PAYÉS", eur(d.totaux.netPaye)],
    ["COÛT TOTAL EMPLOYEUR", eur(d.totaux.coutTotal)],
  ];
  return (
    <Document title={`Journal de paie — ${d.libelleMois}`} author={d.organisation?.name ?? "GODAC"} creator="GODAC" producer="GODAC">
      <Page size="A4" orientation="landscape" style={s.page}>
        <Bandeau s={s} organisation={d.organisation} logo={logo} titre="JOURNAL DE PAIE" sousTitre={d.libelleMois} />
        <Employeur s={s} organisation={d.organisation} />

        <View style={s.table}>
          <View style={s.th} fixed>
            <Text style={[s.thCell, { width: pc(J.nom) }]}>Salarié</Text>
            <Text style={[s.thCell, s.num, { width: pc(J.brut) }]}>Brut</Text>
            {RUBRIQUES.map((r) => (
              <Text key={r.id} style={[s.thCell, s.num, { width: pc(J.rubrique) }]}>
                {`${r.libelle}\nsal. / pat.`}
              </Text>
            ))}
            <Text style={[s.thCell, s.num, { width: pc(J.total) }]}>{"Total\nsalarial"}</Text>
            <Text style={[s.thCell, s.num, { width: pc(J.total) }]}>{"Total\npatronal"}</Text>
            {COLONNES_FIN.map((c) => (
              <Text key={c} style={[s.thCell, s.num, { width: pc(J.autre) }]}>
                {c}
              </Text>
            ))}
          </View>
          {d.lignes.map((l, i) => (
            <LigneJ
              key={l.userId}
              s={s}
              zebre={i % 2 === 1}
              l={{ ...l, sousTitre: [l.matricule && `Mat. ${l.matricule}`, l.statut !== "valide" ? libelleStatut(l.statut) : null].filter(Boolean).join(" · "), alerte: l.statut !== "valide" }}
            />
          ))}
          <LigneJ s={s} zebre={false} total l={{ ...d.totaux, nom: "Total entreprise", sousTitre: `${d.totaux.effectif} bulletin${d.totaux.effectif > 1 ? "s" : ""}` }} />
        </View>

        <View style={s.synthese} wrap={false}>
          {tuiles.map(([e, v]) => (
            <View key={e} style={s.tuile}>
              <Text style={s.tuileEtiquette}>{e}</Text>
              <Text style={s.tuileValeur}>{v}</Text>
            </View>
          ))}
        </View>

        <Text style={s.note}>
          Cotisations par rubrique : part salariale au-dessus, part patronale en dessous. Les exonérations portent la réduction salariale et la
          déduction patronale des heures supplémentaires, et la réduction générale (montants négatifs). Coût total = brut + charges patronales +
          indemnités de frais.
          {d.totaux.nonValides > 0
            ? ` ${d.totaux.nonValides} bulletin${d.totaux.nonValides > 1 ? "s ne sont" : " n'est"} pas encore validé${d.totaux.nonValides > 1 ? "s" : ""} par la direction : ce journal est provisoire.`
            : ""}{" "}
          Document de contrôle : la déclaration sociale nominative (DSN) est établie et déposée par votre expert-comptable. {MENTION_INDICATIVE}
        </Text>
        <PiedDePage s={s} texte={`Journal de paie · ${d.libelleMois} · Édité le ${d.dateEdition}`} />
      </Page>
    </Document>
  );
}

export async function genererJournalPdf(d: JournalPdfData): Promise<Buffer> {
  const logo = await chargerLogo(d.organisation?.logo_url);
  return renderToBuffer(<JournalDoc d={d} logo={logo} />);
}

// ── Registre unique du personnel ───────────────────────────────────

const R = { rang: 3.5, nom: 11, prenoms: 9.5, nationalite: 7, naissance: 6.5, sexe: 4.5, emploi: 10, qualification: 10, entree: 6.5, sortie: 6.5, contrat: 12, titre: 12.5 };

export interface RegistrePdfData {
  organisation: Organisation;
  entrees: EntreeRegistre[];
  dateEdition: string;
}

function LigneR({ s, e, rang, prefixe = "" }: { s: S; e: EntreeRegistre; rang: number; prefixe?: string }) {
  const manque = champsManquants(e);
  const cellules: [keyof typeof R, string][] = [
    ["rang", `${prefixe}${rang}`],
    ["nom", e.nom ?? e.nomAffiche],
    ["prenoms", e.prenoms ?? ""],
    ["nationalite", e.nationalite ?? ""],
    ["naissance", dateFr(e.dateNaissance)],
    ["sexe", e.sexe ? SEXES[e.sexe] : ""],
    ["emploi", e.emploi ?? ""],
    ["qualification", e.qualification ?? ""],
    ["entree", dateFr(e.dateEntree)],
    ["sortie", dateFr(e.dateSortie)],
    ["contrat", libelleContrat(e)],
    ["titre", titreTravail(e)],
  ];
  return (
    <View style={[s.row, rang % 2 === 0 ? { backgroundColor: ZEBRE } : {}, { flexWrap: "wrap" }]} wrap={false}>
      {cellules.map(([k, v]) => (
        <Text key={k} style={[s.cell, { width: pc(R[k]) }]}>
          {v}
        </Text>
      ))}
      {manque.length > 0 && <Text style={[s.cell, s.alerte, { width: "100%", paddingTop: 0 }]}>{`À compléter : ${manque.join(", ")}`}</Text>}
    </View>
  );
}

function RegistreDoc({ d, logo }: { d: RegistrePdfData; logo: LogoPdf | null }) {
  const { s } = styles(d.organisation?.accent_color);
  // Les stagiaires figurent dans une partie distincte (art. L1221-13).
  const { salaries, stagiaires } = partiesRegistre(d.entrees);
  const entrees = [...salaries, ...stagiaires];
  const incomplets = entrees.filter((e) => champsManquants(e).length > 0).length;
  const entetes: [keyof typeof R, string][] = [
    ["rang", "N°"],
    ["nom", "Nom"],
    ["prenoms", "Prénoms"],
    ["nationalite", "Nationalité"],
    ["naissance", "Naissance"],
    ["sexe", "Sexe"],
    ["emploi", "Emploi"],
    ["qualification", "Qualification"],
    ["entree", "Entrée"],
    ["sortie", "Sortie"],
    ["contrat", "Contrat"],
    ["titre", "Titre de travail (type, n°)"],
  ];
  return (
    <Document title="Registre unique du personnel" author={d.organisation?.name ?? "GODAC"} creator="GODAC" producer="GODAC">
      <Page size="A4" orientation="landscape" style={s.page}>
        <Bandeau s={s} organisation={d.organisation} logo={logo} titre="REGISTRE UNIQUE DU PERSONNEL" sousTitre={`Arrêté au ${d.dateEdition}`} />
        <Employeur s={s} organisation={d.organisation} />
        <View style={s.table}>
          <View style={s.th} fixed>
            {entetes.map(([k, l]) => (
              <Text key={k} style={[s.thCell, { width: pc(R[k]) }]}>
                {l}
              </Text>
            ))}
          </View>
          {salaries.map((e, i) => (
            <LigneR key={e.userId} s={s} e={e} rang={i + 1} />
          ))}
          {stagiaires.length > 0 && (
            <View style={[s.row, { backgroundColor: PAPER }]} wrap={false}>
              <Text style={[s.cell, { width: "100%" }]}>Stagiaires (convention de stage), dans l&apos;ordre d&apos;arrivée</Text>
            </View>
          )}
          {stagiaires.map((e, i) => (
            <LigneR key={e.userId} s={s} e={e} rang={i + 1} prefixe="S" />
          ))}
        </View>
        <Text style={s.note}>
          Registre tenu en application des articles L1221-13 et D1221-23 du code du travail : salariés inscrits dans l&apos;ordre des embauches,
          mentions à conserver 5 ans après le départ de chaque salarié. {entrees.length} salarié{entrees.length > 1 ? "s" : ""} inscrit
          {entrees.length > 1 ? "s" : ""}
          {incomplets > 0 ? `, dont ${incomplets} fiche${incomplets > 1 ? "s" : ""} à compléter.` : "."} Les stagiaires (type de contrat
          « Stage ») figurent dans une partie distincte.
        </Text>
        <PiedDePage s={s} texte={`Registre unique du personnel · ${d.organisation?.name ?? ""} · Édité le ${d.dateEdition}`} />
      </Page>
    </Document>
  );
}

export async function genererRegistrePdf(d: RegistrePdfData): Promise<Buffer> {
  const logo = await chargerLogo(d.organisation?.logo_url);
  return renderToBuffer(<RegistreDoc d={d} logo={logo} />);
}
