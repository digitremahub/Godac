import type { ReactNode } from "react";

/**
 * Illustrations SVG des modules, en trois couches (fond, volume, détail)
 * que ModulesProfondeur empile en profondeur (translateZ). Couleurs : jetons
 * du thème (fill-teal, fill-marine…), jamais de palette Tailwind.
 */
export type CleIllustration = "ticpe" | "carburant" | "flotte" | "planning" | "colis" | "go";

const VUE = "0 0 160 120";

function Couche({ n, children }: { n: number; children: ReactNode }) {
  return (
    <svg className="vitrine-couche" viewBox={VUE} style={{ "--n": n } as React.CSSProperties} fill="none">
      {children}
    </svg>
  );
}

const COUCHES: Record<CleIllustration, ReactNode[]> = {
  ticpe: [
    <rect key="a" x="22" y="14" width="116" height="92" rx="10" className="fill-marine/10 stroke-navy/15" strokeWidth="1.5" />,
    <g key="b">
      <ellipse cx="80" cy="78" rx="34" ry="10" className="fill-teal" />
      <ellipse cx="80" cy="68" rx="34" ry="10" className="fill-teal stroke-marine/30" strokeWidth="1" />
      <ellipse cx="80" cy="58" rx="34" ry="10" className="fill-teal stroke-marine/30" strokeWidth="1" />
    </g>,
    <g key="c">
      <path d="M96 22h34v50l-6-4-6 4-6-4-6 4-6-4-4 3z" className="fill-surface stroke-navy/30" strokeWidth="1.5" />
      <path d="M103 34h20M103 42h20M103 50h12" className="stroke-orange" strokeWidth="2.5" strokeLinecap="round" />
    </g>,
  ],
  carburant: [
    <rect key="a" x="22" y="14" width="116" height="92" rx="10" className="fill-marine/10 stroke-navy/15" strokeWidth="1.5" />,
    <g key="b">
      <path d="M52 40v50c0 7 13 12 28 12s28-5 28-12V40" className="fill-teal" />
      <ellipse cx="80" cy="40" rx="28" ry="10" className="fill-teal stroke-marine/30" strokeWidth="1.5" />
      <path d="M52 62c0 7 13 12 28 12s28-5 28-12" className="stroke-marine/30" strokeWidth="1.5" />
    </g>,
    <path key="c" d="M122 26c8 10 12 16 12 22a12 12 0 0 1-24 0c0-6 4-12 12-22z" className="fill-orange" />,
  ],
  flotte: [
    <rect key="a" x="12" y="14" width="136" height="92" rx="10" className="fill-marine/10 stroke-navy/15" strokeWidth="1.5" />,
    <g key="b">
      <rect x="26" y="40" width="64" height="38" rx="4" className="fill-marine" />
      <path d="M92 52h24l12 14v12H92z" className="fill-teal" />
    </g>,
    <g key="c">
      <circle cx="46" cy="82" r="9" className="fill-surface stroke-marine" strokeWidth="4" />
      <circle cx="110" cy="82" r="9" className="fill-surface stroke-marine" strokeWidth="4" />
      <path d="M98 56h14l8 10H98z" className="fill-surface/70" />
    </g>,
  ],
  planning: [
    <rect key="a" x="22" y="14" width="116" height="92" rx="10" className="fill-marine/10 stroke-navy/15" strokeWidth="1.5" />,
    <g key="b">
      <rect x="34" y="28" width="92" height="68" rx="6" className="fill-surface stroke-navy/20" strokeWidth="1.5" />
      <rect x="34" y="28" width="92" height="16" rx="6" className="fill-marine" />
      <g className="fill-navy/20">
        {[0, 1, 2, 3].flatMap((c) => [0, 1].map((r) => <rect key={`${c}${r}`} x={42 + c * 20} y={52 + r * 20} width="14" height="12" rx="2" />))}
      </g>
    </g>,
    <g key="c">
      <rect x="82" y="52" width="14" height="12" rx="2" className="fill-teal" />
      <rect x="62" y="72" width="14" height="12" rx="2" className="fill-orange" />
    </g>,
  ],
  colis: [
    <rect key="a" x="12" y="14" width="136" height="92" rx="10" className="fill-marine/10 stroke-navy/15" strokeWidth="1.5" />,
    <g key="b">
      <path d="M46 52l34-16 34 16v34l-34 16-34-16z" className="fill-orange" />
      <path d="M46 52l34 16 34-16M80 68v34" className="stroke-marine/35" strokeWidth="1.5" />
      <path d="M63 44l34 16" className="stroke-surface" strokeWidth="4" strokeLinecap="round" />
    </g>,
    <g key="c">
      <path d="M118 22c-8 0-14 6-14 14 0 10 14 24 14 24s14-14 14-24c0-8-6-14-14-14z" className="fill-teal stroke-marine" strokeWidth="2" />
      <circle cx="118" cy="36" r="5" className="fill-marine" />
    </g>,
  ],
  go: [
    <rect key="a" x="12" y="14" width="136" height="92" rx="10" className="fill-marine/10 stroke-navy/15" strokeWidth="1.5" />,
    <path key="b" d="M24 96C48 96 52 60 80 60s34-24 56-38" className="stroke-teal" strokeWidth="5" strokeLinecap="round" strokeDasharray="1 11" />,
    <g key="c">
      <path d="M80 28l22 52-22-10-22 10z" className="fill-marine stroke-teal" strokeWidth="3" strokeLinejoin="round" />
    </g>,
  ],
};

/** Illustration empilée en 3D ; aria-hidden : le texte de la carte porte le sens. */
export function IllustrationModule({ cle }: { cle: CleIllustration }) {
  return (
    <div className="vitrine-illu" aria-hidden="true">
      {COUCHES[cle].map((contenu, i) => (
        <Couche key={i} n={i}>
          {contenu}
        </Couche>
      ))}
    </div>
  );
}
