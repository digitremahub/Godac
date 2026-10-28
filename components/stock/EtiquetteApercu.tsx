import { barresCode128, encoderCode128, encodable128 } from "@/lib/stock/code128";
import { mettreEnPage, PT_EN_MM, type DonneesEtiquette } from "@/lib/stock/etiquettes";
import { DEFINITION_FORMATS, type CleFormatEtiquette } from "@/lib/stock/formats-etiquette";
import { cheminQr, matriceQr, tailleTotaleQr } from "@/lib/stock/qr";

/**
 * Aperçu à l'écran d'une étiquette (SVG, mêmes calculs que le PDF) : QR code, code-barres Code 128 et
 * texte lisible. Composant sans script, utilisable côté serveur. Le QR ne contient que le code.
 */
export function EtiquetteApercu({ donnees, format, titre, className = "" }: { donnees: DonneesEtiquette; format: CleFormatEtiquette; titre?: string; className?: string }) {
  const m = mettreEnPage(DEFINITION_FORMATS[format], donnees);
  const qr = matriceQr(donnees.code);
  const tq = tailleTotaleQr(qr);
  const code = encodable128(donnees.code) ? encoderCode128(donnees.code) : null;
  const barres = code ? barresCode128(code) : [];
  const echelle = code && m.codeBarres ? m.codeBarres.l / code.largeurModules : 0;
  const mm = (pt: number) => pt * PT_EN_MM;
  const etiquette = `Étiquette ${donnees.code}${donnees.nature ? `, ${donnees.nature}` : ""}${donnees.temperature ? `, ${donnees.temperature}` : ""}${donnees.fragile ? ", fragile" : ""}${donnees.urgent ? ", urgent" : ""}`;
  return (
    <svg viewBox={`0 0 ${m.largeur} ${m.hauteur}`} role="img" aria-label={titre ?? etiquette} className={`h-auto w-full max-w-sm rounded-md border border-navy/20 bg-white text-black shadow-sm ${className}`} style={{ aspectRatio: `${m.largeur} / ${m.hauteur}` }}>
      <svg x={m.qr.x} y={m.qr.y} width={m.qr.l} height={m.qr.h} viewBox={`0 0 ${tq} ${tq}`}>
        <path d={cheminQr(qr)} fill="#000" />
      </svg>
      {code &&
        m.codeBarres &&
        barres.map((b, i) => <rect key={i} x={m.codeBarres!.x + b.x * echelle} y={m.codeBarres!.y} width={b.largeur * echelle} height={m.codeBarres!.h} fill="#000" />)}
      {[m.code, ...m.textes].map((t, i) => (
        <text
          key={i}
          x={t.alignement === "center" ? t.x + t.l / 2 : t.alignement === "right" ? t.x + t.l : t.x}
          y={t.y + mm(t.taille) * 0.9}
          fontSize={mm(t.taille)}
          fontWeight={t.gras ? 700 : 400}
          textAnchor={t.alignement === "center" ? "middle" : t.alignement === "right" ? "end" : "start"}
          textLength={t.texte.length * mm(t.taille) * 0.62 > t.l ? t.l : undefined}
          lengthAdjust="spacingAndGlyphs"
          fill="#000"
        >
          {t.texte}
        </text>
      ))}
      {m.pictos.map((p, i) => (
        <g key={`p${i}`}>
          <rect x={p.x} y={p.y} width={p.l} height={p.h} fill={p.plein ? "#000" : "#fff"} stroke="#000" strokeWidth={0.25} />
          <text x={p.x + p.l / 2} y={p.y + p.h * 0.68} fontSize={p.h * 0.55} textAnchor="middle" fill={p.plein ? "#fff" : "#000"}>
            {p.texte}
          </text>
        </g>
      ))}
      {m.logo && <rect x={m.logo.x} y={m.logo.y} width={m.logo.l} height={m.logo.h} fill="none" stroke="#999" strokeDasharray="1 1" strokeWidth={0.2} />}
    </svg>
  );
}
