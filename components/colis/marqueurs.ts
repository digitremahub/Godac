// Marqueurs des cartes de la tournée colis (carte de l'app chauffeur et GO
// Navigation) : mêmes codes que les cartes d'arrêt (encoche et couleur par
// type : ramasse dorée, point relais violet).
import type { Stop } from "@/components/colis/commun";
import { COULEURS_CARTE } from "@/lib/colis/style-carte";

const { teal: TEAL, marine: NAVY, gold: GOLD, relais: RELAIS } = COULEURS_CARTE;

/** Pastille numérotée ; une ramasse a une encoche (coin carré) et une bordure dorée, un point relais une bordure violette. */
export function pastille(numero: string, statut: Stop["status"], actif: boolean, ramasse = false, relais = false): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  el.textContent = numero;
  const fond = statut === "delivered" ? "#9AA3B5" : statut === "failed" ? "#F25A22" : actif ? TEAL : NAVY;
  const texte = statut === "pending" && actif ? NAVY : "#FFFFFF";
  const taille = actif ? 38 : 28;
  Object.assign(el.style, {
    width: `${taille}px`,
    height: `${taille}px`,
    borderRadius: ramasse || relais ? "999px 999px 999px 3px" : "999px",
    background: fond,
    color: texte,
    border: ramasse ? `3px solid ${GOLD}` : relais ? `3px solid ${RELAIS}` : "2px solid #FFFFFF",
    boxShadow: "0 2px 6px rgba(10,15,30,.35)",
    font: `700 ${actif ? 15 : 12}px system-ui, sans-serif`,
    cursor: "pointer",
    zIndex: actif ? "2" : "1",
  });
  return el;
}

/**
 * Véhicule du chauffeur (GO Navigation) : flèche de navigation marine à
 * contour blanc sur un petit halo teal, qui pointe vers l'avant. Posée à
 * plat sur la carte (marqueur aligné sur la carte) : son orientation suit
 * `setRotation(cap)`, donc elle reste vers le haut en vue conduite (la carte
 * tourne avec le cap) et pivote en vue d'ensemble. Sans cap connu : un
 * simple rond (`etatVehicule`).
 */
export function marqueurVehicule(): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("aria-label", "Votre position");
  el.setAttribute("role", "img");
  Object.assign(el.style, { width: "44px", height: "44px", position: "relative", pointerEvents: "none" });
  el.innerHTML =
    `<div style="position:absolute;inset:2px;border-radius:999px;background:rgba(27,228,193,.28);box-shadow:0 0 0 1px rgba(27,228,193,.45)"></div>` +
    `<svg data-fleche="1" viewBox="0 0 24 24" width="34" height="34" style="position:absolute;left:5px;top:4px;filter:drop-shadow(0 2px 3px rgba(10,15,30,.45))" aria-hidden="true">` +
    `<path d="M12 2.5 L19.5 20.5 L12 16.6 L4.5 20.5 Z" fill="${NAVY}" stroke="#FFFFFF" stroke-width="2" stroke-linejoin="round"/></svg>` +
    `<div data-rond="1" style="display:none;position:absolute;left:12px;top:12px;width:20px;height:20px;border-radius:999px;background:${NAVY};border:3px solid #FFFFFF;box-shadow:0 2px 6px rgba(10,15,30,.45)"></div>`;
  return el;
}

/** Flèche si le cap est connu, rond sinon. */
export function etatVehicule(el: HTMLElement, capConnu: boolean) {
  const fleche = el.querySelector<SVGElement>("[data-fleche]");
  const rond = el.querySelector<HTMLElement>("[data-rond]");
  if (fleche) fleche.style.display = capConnu ? "block" : "none";
  if (rond) rond.style.display = capConnu ? "none" : "block";
}
