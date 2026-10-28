import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChampsAttributs } from "@/components/stock/ChampsAttributs";
import { EtiquetteApercu } from "@/components/stock/EtiquetteApercu";
import { construireEtiquette } from "@/lib/stock/etiquettes";
import { valeursInitiales } from "@/lib/stock/formulaire";
import { DEFINITION_PROFILS, CHAMPS_ETIQUETTE } from "@/lib/stock/profils";

const lire = (f: string) => readFileSync(f, "utf8");
const rendre = (profil: keyof typeof DEFINITION_PROFILS) => renderToStaticMarkup(createElement(ChampsAttributs, { profil: DEFINITION_PROFILS[profil], valeurs: valeursInitiales(DEFINITION_PROFILS[profil]), onChange: () => undefined }));

describe("formulaire d'entrée : champs du profil, obligatoires marqués, accessibles", () => {
  it("santé : la température est marquée « obligatoire » et exigée (required) ; nature et urgent préremplis", () => {
    const html = rendre("sante");
    expect(html).toMatch(/Température \(obligatoire\)/);
    expect(html).toMatch(/<select[^>]*required[^>]*>\s*<option value="">Non précisée<\/option>/);
    expect(html).toContain("Urgent");
    expect(html).toMatch(/<input type="checkbox"[^>]*checked/);
  });
  it("pharmacie : lot et DLC obligatoires", () => {
    const html = rendre("pharmacie");
    expect(html).toMatch(/Lot \(obligatoire\)/);
    expect(html).toMatch(/Date limite \(DLC\) \(obligatoire\)/);
    expect((html.match(/required=""/g) ?? []).length).toBe(2);
  });
  it("colis : poids et volume facultatifs, ni SSCC ni lot ni température", () => {
    const html = rendre("messagerie");
    expect(html).toContain("Poids (kg)");
    expect(html).toContain("Volume (m³)");
    expect(html).not.toContain("SSCC");
    expect(html).not.toContain("Lot");
    expect(html).not.toContain("obligatoire)");
  });
  it("palettes : SSCC proposé", () => {
    expect(rendre("palettes")).toContain("SSCC (18 chiffres)");
  });
  it("chaque champ a un libellé relié (label for = id) et l'avertissement sur les données de santé est affiché", () => {
    const html = rendre("sante");
    const ids = [...html.matchAll(/<(?:input|select)[^>]*\sid="([^"]+)"/g)].map((m) => m[1]!);
    expect(ids.length).toBeGreaterThan(4);
    for (const id of ids) expect(html, id).toContain(`for="${id}"`);
    expect(html).toMatch(/donnée de santé nominative/);
  });
  it("consigne limitée à 120 caractères, avec compteur annoncé", () => {
    const html = rendre("messagerie");
    expect(html).toMatch(/maxLength="120"|maxlength="120"/i);
    expect(html).toContain("0/120 caractères");
  });
  it("mode fiche : poids, volume et SSCC ne sont pas modifiables", () => {
    const html = renderToStaticMarkup(createElement(ChampsAttributs, { profil: DEFINITION_PROFILS.palettes, valeurs: valeursInitiales(DEFINITION_PROFILS.palettes), onChange: () => undefined, sansMesures: true }));
    expect(html).not.toContain("Poids (kg)");
    expect(html).not.toContain("SSCC");
  });
});

describe("aperçu de l'étiquette à l'écran (SVG)", () => {
  const d = construireEtiquette({ code: "TRA-2026-000042", nature: "prelevement", temperature: "frais", fragile: true, urgent: true, consigne: "Au frais" }, { entreprise: "Transports Martin", depot: "Nord", date: "28/10/2026" }, CHAMPS_ETIQUETTE);
  const html = renderToStaticMarkup(createElement(EtiquetteApercu, { donnees: d, format: "thermique_100x150" }));
  it("alternative textuelle complète pour les lecteurs d'écran", () => {
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Étiquette TRA-2026-000042, Prélèvement, 2-8 °C, fragile, urgent"');
  });
  it("QR code, barres Code 128, code en clair, pictogrammes", () => {
    expect(html).toMatch(/<path d="M\d+ \d+h\d+v1/);
    expect((html.match(/<rect /g) ?? []).length).toBeGreaterThan(40);
    expect(html).toContain(">TRA-2026-000042</text>");
    expect(html).toContain(">URGENT</text>");
    expect(html).toContain(">FRAGILE</text>");
  });
  it("proportions de l'étiquette réelle (100 × 150) et mobile : largeur 100 % bornée", () => {
    expect(html).toContain('viewBox="0 0 100 150"');
    expect(html).toMatch(/w-full max-w-sm/);
  });
  it("aucune donnée personnelle dans l'aperçu", () => {
    expect(html).not.toMatch(/patient|destinataire|donneur/i);
  });
});

describe("écrans : boutons et cases demandés", () => {
  const mouvement = lire("components/stock/MouvementRapide.tsx");
  it("entrée : « Générer un code » quand le champ code est vide, case « Imprimer l'étiquette après l'entrée »", () => {
    expect(mouvement).toMatch(/code\.trim\(\) === "" \? \([\s\S]*Générer un code/);
    expect(mouvement).toContain("Imprimer l&apos;étiquette après l&apos;entrée");
    expect(mouvement).toContain("Ajouter aussi un code interne de l&apos;entreprise");
    expect(mouvement).toContain("/api/stock/codes");
    expect(mouvement).toMatch(/\/api\/stock\/etiquettes\?unites=/);
  });
  it("entrée : le bouton « Générer un code » n'existe que pour une entrée et si les codes sont installés", () => {
    expect(mouvement).toMatch(/estEntree && codesInstalles && \(/);
  });
  it("le profil de l'entrée se choisit et se mémorise quand plusieurs profils sont actifs", () => {
    expect(mouvement).toContain('lireMemoire("stock:profil:unites")');
    expect(mouvement).toContain('ecrireMemoire("stock:profil:unites", p)');
    expect(mouvement).toContain("Profil de l'entrée");
  });
  it("sortie d'article : suggestion FEFO avec bouton « Choisir ce lot »", () => {
    expect(mouvement).toContain("suggestionFefo(soldes, articleId, siteId)");
    expect(mouvement).toContain("Choisir ce lot");
    expect(mouvement).toMatch(/role="status"/);
  });
  it("une même action rejouée ne consomme pas un second numéro (clé de génération conservée)", () => {
    expect(mouvement).toContain("clesGeneration");
    expect(mouvement).toContain("internes.current.get(empreinte)");
  });
  it("mobile : zones de toucher de 44 px (min-h-11) sur les boutons et cases", () => {
    expect((mouvement.match(/min-h-11/g) ?? []).length).toBeGreaterThanOrEqual(8);
    expect(mouvement).not.toMatch(/overflow-x-scroll|w-\[\d{3,}px\]/);
  });
  it("fiche d'unité : code, code interne, attributs, QR à l'écran, bouton Imprimer / réimprimer", () => {
    const page = lire("app/(dashboard)/exploitation/stock/unites/[id]/page.tsx");
    for (const t of ["Code principal", "Code interne", "Nature", "Température", "Fragile", "Urgent", "Consigne", "QR code", "EtiquetteApercu"]) expect(page, t).toContain(t);
    expect(lire("components/stock/FicheUniteActions.tsx")).toContain("Imprimer ou réimprimer l&apos;étiquette");
    expect(lire("components/stock/FicheUniteActions.tsx")).toMatch(/\/api\/stock\/etiquettes\?unites=\$\{unite\.id\}&format=\$\{format\}/);
  });
  it("page des étiquettes : planche de 24 / 50 / 100, formats, planche entamée, PDF à ouvrir", () => {
    const planche = lire("components/stock/EtiquettesPlanche.tsx");
    expect(planche).toContain("const PRESETS = [24, 50, 100]");
    expect(planche).toContain("Étiquettes déjà utilisées sur la première planche");
    expect(planche).toContain("Ouvrir le PDF pour imprimer");
    expect(planche).toContain('mode: "vierges"');
    expect(planche).toMatch(/aria-live="polite"/);
  });
  it("liste : lien vers la fiche, code interne, attributs, exports CSV et Excel des unités", () => {
    const liste = lire("app/(dashboard)/exploitation/stock/liste/page.tsx");
    expect(liste).toContain("/exploitation/stock/unites/${u.id}");
    expect(liste).toContain("resumeAttributs(u)");
    expect(liste).toContain("/api/stock/unites/export");
    expect(liste).toContain('name="nature"');
    expect(liste).toContain('name="temperature"');
    expect(liste).toContain('name="urgent"');
  });
  it("mention de suivi logistique sur le tableau de bord, l'entrée, la fiche, les étiquettes et les paramètres", () => {
    for (const f of ["app/(dashboard)/exploitation/stock/page.tsx", "app/(dashboard)/exploitation/stock/mouvement/page.tsx", "app/(dashboard)/exploitation/stock/unites/[id]/page.tsx", "app/(dashboard)/exploitation/stock/etiquettes/page.tsx", "components/stock/ParametresStock.tsx"]) {
      expect(lire(f), f).toContain("MENTION_SUIVI_LOGISTIQUE");
    }
  });
  it("paramètres : profils adaptables (vocabulaire, champs, alertes, étiquette, FEFO) et préfixe", () => {
    const p = lire("components/stock/ParametresStock.tsx");
    for (const t of ["Vocabulaire", "Champs de l&apos;entrée", "Alertes", "Étiquette", "Suggestion FEFO à la sortie", "Alerte « DLC proche » à J-", "Préfixe des codes", "Revenir aux valeurs du catalogue", "Enregistrer le format"]) expect(p, t).toContain(t);
  });
});
