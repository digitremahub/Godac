import "server-only";
import { Document, Page, Path, Rect, StyleSheet, Svg, Text, View, Image, renderToBuffer } from "@react-pdf/renderer";
// Importer lib/paie/pdf.tsx déclare aussi la police NotoSans embarquée (next.config.mjs : assets/fonts tracés pour la route).
import { PALETTE_PDF, type LogoPdf } from "@/lib/paie/pdf";
import { barresCode128, encodable128, encoderCode128 } from "@/lib/stock/code128";
import { mettreEnPage, type DonneesEtiquette, type MiseEnPage } from "@/lib/stock/etiquettes";
import { mmEnPt, paginer, positionsEtiquettes, type FormatEtiquette } from "@/lib/stock/formats-etiquette";
import { cheminQr, matriceQr, tailleTotaleQr } from "@/lib/stock/qr";

/**
 * Rendu PDF des étiquettes (react-pdf, côté serveur). Noir sur blanc : lisible sur
 * imprimante thermique. Le QR code et le code-barres sont dessinés en vectoriel.
 * La mise en page vient de lib/stock/etiquettes.ts (testée sans moteur PDF).
 */

const NOIR = "#000000";
const BLANC = "#FFFFFF";
void PALETTE_PDF;

const s = StyleSheet.create({
  page: { backgroundColor: BLANC, fontFamily: "NotoSans", color: NOIR },
  texte: { color: NOIR },
});

const pt = mmEnPt;

function Etiquette({ d, m, logo }: { d: DonneesEtiquette; m: MiseEnPage; logo: LogoPdf | null }) {
  const qr = matriceQr(d.code);
  const tq = tailleTotaleQr(qr);
  const code = encodable128(d.code) ? encoderCode128(d.code) : null;
  const barres = code ? barresCode128(code) : [];
  const echelleBarres = code && m.codeBarres ? pt(m.codeBarres.l) / code.largeurModules : 0;
  // 0,5 pt de moins que la page : un arrondi ne doit jamais créer une page blanche en plus.
  return (
    <View style={{ width: pt(m.largeur) - 0.5, height: pt(m.hauteur) - 0.5, position: "relative" }}>
      <Svg viewBox={`0 0 ${tq} ${tq}`} width={pt(m.qr.l)} height={pt(m.qr.h)} style={{ position: "absolute", left: pt(m.qr.x), top: pt(m.qr.y) }}>
        <Path d={cheminQr(qr)} fill={NOIR} />
      </Svg>
      {m.logo && logo && <Image src={logo} style={{ position: "absolute", left: pt(m.logo.x), top: pt(m.logo.y), width: pt(m.logo.l), height: pt(m.logo.h), objectFit: "contain" }} />}
      {code && m.codeBarres && (
        <Svg viewBox={`0 0 ${pt(m.codeBarres.l)} ${pt(m.codeBarres.h)}`} width={pt(m.codeBarres.l)} height={pt(m.codeBarres.h)} style={{ position: "absolute", left: pt(m.codeBarres.x), top: pt(m.codeBarres.y) }}>
          {barres.map((b, i) => (
            <Rect key={i} x={b.x * echelleBarres} y={0} width={b.largeur * echelleBarres} height={pt(m.codeBarres!.h)} fill={NOIR} />
          ))}
        </Svg>
      )}
      {[m.code, ...m.textes].map((t, i) => (
        <Text key={i} style={[s.texte, { position: "absolute", left: pt(t.x), top: pt(t.y), width: pt(t.l), maxHeight: pt(t.h), fontSize: t.taille, textAlign: t.alignement ?? "left", lineHeight: 1.15, maxLines: t.lignesMax }]}>
          {t.texte}
        </Text>
      ))}
      {m.pictos.map((p, i) => (
        <View
          key={`p${i}`}
          style={{
            position: "absolute",
            left: pt(p.x),
            top: pt(p.y),
            width: pt(p.l),
            height: pt(p.h),
            borderWidth: 0.9,
            borderColor: NOIR,
            backgroundColor: p.plein ? NOIR : BLANC,
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          <Text style={{ color: p.plein ? BLANC : NOIR, fontSize: Math.min(9, pt(p.h) * 0.5), lineHeight: 1, textAlign: "center" }}>{p.texte}</Text>
        </View>
      ))}
    </View>
  );
}

export interface ParametresPdfEtiquettes {
  format: FormatEtiquette;
  etiquettes: readonly DonneesEtiquette[];
  logo?: LogoPdf | null;
  /** Emplacements déjà utilisés sur la première planche (réutiliser une planche entamée). */
  debut?: number;
  titre?: string;
  /** Cadre fin autour de chaque étiquette (aide au découpage, désactivé sur planche adhésive). */
  cadre?: boolean;
}

function Doc({ format, etiquettes, logo = null, debut = 0, titre = "Étiquettes de stock", cadre = false }: ParametresPdfEtiquettes) {
  const pages = paginer(etiquettes, format, debut);
  const positions = positionsEtiquettes(format);
  return (
    <Document title={titre} author="GODAC" creator="GODAC">
      {pages.map((page, i) => (
        <Page key={i} size={[pt(format.page.largeur), pt(format.page.hauteur)]} style={s.page}>
          {page.map((d, k) =>
            d ? (
              <View key={k} style={{ position: "absolute", left: pt(positions[k]!.x), top: pt(positions[k]!.y), ...(cadre && format.planche ? { borderWidth: 0.3, borderColor: "#999999" } : {}) }}>
                <Etiquette d={d} m={mettreEnPage(format, d)} logo={logo} />
              </View>
            ) : null,
          )}
        </Page>
      ))}
    </Document>
  );
}

export async function genererEtiquettesPdf(p: ParametresPdfEtiquettes): Promise<Buffer> {
  return renderToBuffer(<Doc {...p} />);
}
