/**
 * Avant / après d'une modification, pour le journal d'audit — pur, testé.
 * Ne garde que les champs réellement changés, avec leur ancienne et leur
 * nouvelle valeur (null si le champ n'existait pas ou n'a pas pu être lu).
 */

export type AvantApres = {
  avant: Record<string, unknown>;
  apres: Record<string, unknown>;
};

const norm = (v: unknown) => (v === undefined || v === "" ? null : v);

function egal(a: unknown, b: unknown): boolean {
  const x = norm(a);
  const y = norm(b);
  if (x === y) return true;
  if (x === null || y === null) return false;
  if (typeof x === "object" || typeof y === "object") return JSON.stringify(x) === JSON.stringify(y);
  // Nombres venant de PostgREST sous forme de texte (« 300.00 ») ou de nombre.
  if ((typeof x === "number" || typeof x === "string") && (typeof y === "number" || typeof y === "string")) {
    const nx = Number(x);
    const ny = Number(y);
    if (Number.isFinite(nx) && Number.isFinite(ny) && String(x).trim() !== "" && String(y).trim() !== "") return nx === ny;
  }
  return false;
}

/** Champs modifiés entre l'état lu avant l'écriture et les valeurs écrites. */
export function avantApres(avant: Record<string, unknown> | null | undefined, apres: Record<string, unknown>): AvantApres {
  const res: AvantApres = { avant: {}, apres: {} };
  for (const [champ, nouveau] of Object.entries(apres)) {
    const ancien = avant ? avant[champ] : undefined;
    if (avant && egal(ancien, nouveau)) continue;
    res.avant[champ] = norm(ancien);
    res.apres[champ] = norm(nouveau);
  }
  return res;
}

/** Aucun champ n'a changé. */
export const aucunChangement = (d: AvantApres) => Object.keys(d.apres).length === 0;
