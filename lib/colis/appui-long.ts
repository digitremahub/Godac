/**
 * Appui long (500 ms) sur une ligne ou un repère de la carte : ouvre le menu
 * rapide de l'arrêt. Un déplacement du doigt (défilement, glisser) l'annule ;
 * le clic qui suit un appui long déclenché est ignoré.
 */
export const DELAI_APPUI_LONG_MS = 500;
const TOLERANCE_PX = 10;

export function creerAppuiLong(declencher: () => void, delaiMs = DELAI_APPUI_LONG_MS) {
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  let depart: { x: number; y: number } | null = null;
  let declenche = false;
  const annuler = () => {
    clearTimeout(minuterie);
    minuterie = undefined;
    depart = null;
  };
  return {
    debut(x: number, y: number) {
      annuler();
      declenche = false;
      depart = { x, y };
      minuterie = setTimeout(() => {
        declenche = true;
        minuterie = undefined;
        declencher();
      }, delaiMs);
    },
    deplace(x: number, y: number) {
      if (depart && Math.hypot(x - depart.x, y - depart.y) > TOLERANCE_PX) annuler();
    },
    fin: annuler,
    /** true (une seule fois) si le clic qui arrive est la fin d'un appui long déjà traité. */
    clicIgnore(): boolean {
      const r = declenche;
      declenche = false;
      return r;
    },
  };
}

/** Un seul doigt à la fois : l'état est partagé (l'écran GO se redessine à chaque point GPS, un état par rendu perdrait la minuterie). */
let aOuvrir: (() => void) | null = null;
const partage = creerAppuiLong(() => aOuvrir?.());

/** Gestes React d'un élément (`{...gestesAppuiLong(() => ouvrir(s))}`). */
export function gestesAppuiLong(declencher: () => void) {
  return {
    onPointerDown: (e: { clientX: number; clientY: number }) => {
      aOuvrir = declencher;
      partage.debut(e.clientX, e.clientY);
    },
    onPointerMove: (e: { clientX: number; clientY: number }) => partage.deplace(e.clientX, e.clientY),
    onPointerUp: partage.fin,
    onPointerCancel: partage.fin,
    onPointerLeave: partage.fin,
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
    onClickCapture: (e: { stopPropagation: () => void; preventDefault: () => void }) => {
      if (partage.clicIgnore()) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
  };
}

/** Même geste sur un élément DOM (repère de la carte) ; renvoie la fonction de nettoyage. */
export function attacherAppuiLong(el: HTMLElement, declencher: () => void): () => void {
  const a = creerAppuiLong(declencher);
  const bas = (e: PointerEvent) => a.debut(e.clientX, e.clientY);
  const bouge = (e: PointerEvent) => a.deplace(e.clientX, e.clientY);
  const clic = (e: Event) => {
    if (a.clicIgnore()) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  };
  el.addEventListener("pointerdown", bas);
  el.addEventListener("pointermove", bouge);
  el.addEventListener("pointerup", a.fin);
  el.addEventListener("pointercancel", a.fin);
  el.addEventListener("click", clic, true);
  return () => {
    a.fin();
    el.removeEventListener("pointerdown", bas);
    el.removeEventListener("pointermove", bouge);
    el.removeEventListener("pointerup", a.fin);
    el.removeEventListener("pointercancel", a.fin);
    el.removeEventListener("click", clic, true);
  };
}
