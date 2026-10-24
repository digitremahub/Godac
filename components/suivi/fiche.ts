// Fiche d'un chauffeur sur la carte du suivi (popup MapLibre) : chauffeur,
// tournée, avancement, prochain arrêt, retard et bouton d'appel. Construite
// en DOM (textContent) comme les popups d'arrêt : aucune donnée n'est
// interprétée comme du HTML.
import type { TourneeSuivie } from "@/app/api/suivi/route";
import { heureFin } from "@/lib/colis/estimation";
import { lienTel } from "@/lib/colis/telephone";
import { LIBELLES_ETAT, libelleRetard, libelleSignal } from "@/lib/exploitation/retards";
import { COULEUR_ETAT } from "@/components/suivi/etat";

function ligne(texte: string, style = ""): HTMLElement {
  const el = document.createElement("div");
  el.textContent = texte;
  if (style) el.style.cssText = style;
  return el;
}

export function ficheChauffeur(t: TourneeSuivie): HTMLElement {
  const r = t.retard;
  const contenu = document.createElement("div");
  contenu.style.cssText = "min-width:230px;max-width:290px;font:13px system-ui,sans-serif;color:#0A0F1E";
  const titre = ligne(t.chauffeur, "font-size:14px;font-weight:700");
  contenu.append(titre);
  if (t.nom) contenu.append(ligne(t.nom, "color:#4B5563;margin-bottom:6px"));
  if (r) {
    const c = COULEUR_ETAT[r.etat];
    const etat = ligne(LIBELLES_ETAT[r.etat], `display:inline-block;margin:2px 0 6px;padding:2px 8px;border-radius:999px;font-weight:700;font-size:12px;background:${c.fond};color:${c.texte}`);
    contenu.append(etat);
    if (r.retardMin > 0) contenu.append(ligne(`Retard estimé : ${libelleRetard(r.retardMin)}`, "font-weight:600"));
    if (r.horsLigne) contenu.append(ligne(`Position ${libelleSignal(r.signal, r.derniereMajMin)}`, "color:#4B5563"));
  }
  contenu.append(ligne(`${t.adressesFaites}/${t.adressesTotal} adresses faites · ${t.adressesRestantes} restante${t.adressesRestantes > 1 ? "s" : ""}`, "margin-top:4px"));
  if (t.finEstimee) contenu.append(ligne(`Fin estimée ${heureFin(t.finEstimee)}${t.finPrevue ? ` (prévue ${heureFin(t.finPrevue)})` : ""}`));
  const prochain = t.arrets.find((a) => a.status === "pending");
  if (prochain) contenu.append(ligne(`Prochain arrêt : ${prochain.adresse}`, "margin-top:4px;white-space:normal"));
  if (t.telephone) {
    const appel = document.createElement("a");
    appel.href = lienTel(t.telephone);
    appel.textContent = "Appeler le chauffeur";
    appel.style.cssText = "display:block;margin-top:8px;padding:8px 10px;border-radius:10px;background:#0A0F1E;color:#FFFFFF;text-align:center;font-weight:600;text-decoration:none";
    contenu.append(appel);
  }
  return contenu;
}
