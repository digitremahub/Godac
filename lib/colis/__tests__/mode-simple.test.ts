import { describe, expect, it } from "vitest";
import { ecrireModesLocaux, estModeSimple, libelleLivre, lireModesLocaux, livraisonDirecte, modeAffiche, modeEffectif, motifParDefaut, refusPreuveSelonMode } from "@/lib/colis/mode-simple";
import { appliquerContacts } from "@/lib/colis/contacts";

describe("mode simple d'une tournée", () => {
  it("le mode complet reste le défaut (colonne absente ou fausse)", () => {
    expect(estModeSimple(null)).toBe(false);
    expect(estModeSimple({})).toBe(false);
    expect(estModeSimple({ mode_simple: false })).toBe(false);
    expect(estModeSimple({ mode_simple: true })).toBe(true);
  });

  it("« Non livré » en 1 clic : motif par défaut selon le type d'arrêt", () => {
    expect(motifParDefaut("livraison")).toBe("absent");
    expect(motifParDefaut(null)).toBe("absent");
    expect(motifParDefaut("ramasse")).toBe("rien_a_ramasser");
    expect(motifParDefaut("point_relais")).toBe("ferme");
  });

  it("aucune preuve exigée en mode simple, les règles habituelles sinon", () => {
    const sansPreuve = { lieu: "boite_aux_lettres", photo: false, code: null, relais: null } as const;
    expect(refusPreuveSelonMode(true, sansPreuve)).toBeNull();
    expect(refusPreuveSelonMode(true, { ...sansPreuve, lieu: "qr_code" })).toBeNull();
    expect(refusPreuveSelonMode(true, { ...sansPreuve, lieu: "point_relais" })).toBeNull();
    expect(refusPreuveSelonMode(false, sansPreuve)).toMatch(/Photo obligatoire/);
    expect(refusPreuveSelonMode(false, { ...sansPreuve, lieu: "main_propre" })).toBeNull();
  });

  it("« Livré » clôt directement en mode simple, avec le même libellé pour tous les types", () => {
    expect(livraisonDirecte(true)).toBe(true);
    expect(livraisonDirecte(false)).toBe(false);
    expect(libelleLivre(true, { kind: "ramasse" })).toBe("Livré");
    expect(libelleLivre(true, { kind: "point_relais" })).toBe("Livré");
    expect(libelleLivre(false, { kind: "ramasse" })).toBe("Ramassé");
    expect(libelleLivre(false, { kind: "point_relais" })).toBe("Déposé au relais");
  });
});

describe("bascule du mode en cours de tournée", () => {
  const run = { id: "r1", mode_simple: false, mode_simple_persiste: true };

  it("le dernier choix de l'écran l'emporte tout de suite, même avant la réponse du serveur", () => {
    expect(modeAffiche(run, new Set(), null)).toBe(false);
    expect(modeAffiche(run, new Set(), { id: "r1", simple: true })).toBe(true);
    expect(modeAffiche({ ...run, mode_simple: true }, new Set(), { id: "r1", simple: false })).toBe(false);
  });

  it("un choix fait sur une autre tournée ne s'applique pas", () => {
    expect(modeAffiche(run, new Set(), { id: "autre", simple: true })).toBe(false);
  });

  it("sans tournée : mode complet", () => {
    expect(modeAffiche(null, new Set(), { id: "r1", simple: true })).toBe(false);
  });

  it("migration non appliquée : le mode reste mémorisé sur l'appareil", () => {
    const sansColonne = { id: "r1", mode_simple: false, mode_simple_persiste: false };
    const brut = ecrireModesLocaux(new Set(), "r1", true);
    expect(modeEffectif(sansColonne, lireModesLocaux(brut))).toBe(true);
    // Colonne présente : la mémoire de l'appareil est ignorée.
    expect(modeEffectif(run, lireModesLocaux(brut))).toBe(false);
    // Retour au mode complet.
    expect(modeEffectif(sansColonne, lireModesLocaux(ecrireModesLocaux(lireModesLocaux(brut), "r1", false)))).toBe(false);
  });

  it("mémoire locale illisible : ignorée, 50 tournées au plus", () => {
    expect(lireModesLocaux("pas du json").size).toBe(0);
    expect(lireModesLocaux(null).size).toBe(0);
    expect(lireModesLocaux('{"a":1}').size).toBe(0);
    let brut = "[]";
    for (let i = 0; i < 60; i++) brut = ecrireModesLocaux(lireModesLocaux(brut), `r${i}`, true);
    expect(lireModesLocaux(brut).size).toBe(50);
  });

  it("changer de mode ne touche pas aux arrêts : clôturés et contacts conservés", () => {
    const stops = [
      { id: "a", status: "delivered", contact_message: true },
      { id: "b", status: "failed", contact_phone: true },
      { id: "c", status: "pending" },
    ];
    const avant = JSON.stringify(stops);
    // Le mode n'intervient que dans l'affichage : aucune fonction de mode ne modifie la liste.
    modeAffiche({ id: "r1" }, new Set(), { id: "r1", simple: true });
    expect(JSON.stringify(stops)).toBe(avant);
    expect(appliquerContacts(stops, "c", { contact_phone: true }, "2026-01-01T10:00:00Z").map((s) => s.status)).toEqual(["delivered", "failed", "pending"]);
  });
});
