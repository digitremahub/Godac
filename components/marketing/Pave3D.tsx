import type { CSSProperties } from "react";

type Teinte = "blanc" | "teal" | "orange" | "ardoise";

/**
 * Pavé en CSS 3D, posé sur un plan : `x`/`y` en % du plan, `l` (largeur),
 * `p` (profondeur) et `h` (hauteur) en unités de 1cqw, `z` (altitude) idem.
 * Pur décor (aria-hidden côté parent).
 */
export function Pave3D({ x, y, l, p, h, z = 0, teinte }: { x: string; y: string; l: number; p: number; h: number; z?: number; teinte: Teinte }) {
  const style = { "--x": x, "--y": y, "--l": l, "--p": p, "--h": h, "--z": z } as CSSProperties;
  return (
    <span className={`pave pave--${teinte}`} style={style}>
      <i className="f-haut" />
      <i className="f-avant" />
      <i className="f-arriere" />
      <i className="f-gauche" />
      <i className="f-droite" />
    </span>
  );
}
