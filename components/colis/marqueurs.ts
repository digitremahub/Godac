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
 * Position du chauffeur : rond marine cerclé de teal, avec une flèche de
 * cap (orientée par `orienterChauffeur`) quand le téléphone la donne.
 */
export function marqueurChauffeur(): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("aria-label", "Votre position");
  Object.assign(el.style, { width: "30px", height: "30px", position: "relative", pointerEvents: "none" });
  const halo = document.createElement("div");
  Object.assign(halo.style, { position: "absolute", inset: "-10px", borderRadius: "999px", background: "rgba(27,228,193,.22)" });
  const fleche = document.createElement("div");
  fleche.dataset.cap = "1";
  Object.assign(fleche.style, {
    position: "absolute",
    left: "50%",
    top: "-9px",
    width: "0",
    height: "0",
    marginLeft: "-7px",
    borderLeft: "7px solid transparent",
    borderRight: "7px solid transparent",
    borderBottom: `11px solid ${NAVY}`,
    transformOrigin: "7px 24px",
    display: "none",
  });
  const rond = document.createElement("div");
  Object.assign(rond.style, { position: "absolute", inset: "0", borderRadius: "999px", background: NAVY, border: `4px solid ${TEAL}`, boxShadow: "0 2px 8px rgba(10,15,30,.45)" });
  el.append(halo, fleche, rond);
  return el;
}

/** Oriente la flèche de cap (degrés, nord = 0) ; null la masque. */
export function orienterChauffeur(el: HTMLElement, cap: number | null) {
  const fleche = el.querySelector<HTMLElement>("[data-cap]");
  if (!fleche) return;
  if (cap === null || !Number.isFinite(cap)) fleche.style.display = "none";
  else {
    fleche.style.display = "block";
    fleche.style.transform = `rotate(${cap}deg)`;
  }
}
