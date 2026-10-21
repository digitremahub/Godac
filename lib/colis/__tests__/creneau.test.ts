import { describe, expect, it, vi } from "vitest";
import {
  CRENEAU_AUCUN,
  PRESETS_CRENEAU,
  choisirCreneau,
  choixDepuisCreneau,
  colonnesCreneau,
  creneauApresAjout,
  erreurCreneau,
  libelleChoix,
  schemaCreneau,
  suggestionOuverture,
  validerChoix,
} from "@/lib/colis/creneau";
import { fenetresArret } from "@/lib/colis/horaires";

vi.mock("server-only", () => ({}));
const { nettoyerEtiquette } = await import("@/lib/colis/lecture-ia");

describe("préréglages du créneau", () => {
  it("« Aucun » par défaut : pas de créneau envoyé", () => {
    expect(validerChoix(CRENEAU_AUCUN)).toEqual({ ok: true, creneau: null });
    expect(libelleChoix(CRENEAU_AUCUN)).toBeNull();
  });

  it("« Avant 10 h » et « Avant 12 h » : fin seule", () => {
    expect(validerChoix(choisirCreneau("avant10"))).toEqual({ ok: true, creneau: { debut: null, fin: "10:00" } });
    expect(validerChoix(choisirCreneau("avant12"))).toEqual({ ok: true, creneau: { debut: null, fin: "12:00" } });
    expect(libelleChoix(choisirCreneau("avant10"))).toBe("Avant 10h");
  });

  it("créneaux Predict DPD : début et fin", () => {
    expect(validerChoix(choisirCreneau("10-13"))).toEqual({ ok: true, creneau: { debut: "10:00", fin: "13:00" } });
    expect(validerChoix(choisirCreneau("12-15"))).toEqual({ ok: true, creneau: { debut: "12:00", fin: "15:00" } });
    expect(libelleChoix(choisirCreneau("08-10"))).toBe("8h–10h");
    // Tous les préréglages sont valables et cohérents.
    for (const p of PRESETS_CRENEAU) expect(validerChoix(choisirCreneau(p.cle)).ok).toBe(true);
  });

  it("« Horaires d'ouverture » : pas de créneau ponctuel, l'annuaire s'applique", () => {
    expect(validerChoix(choisirCreneau("ouverture"))).toEqual({ ok: true, creneau: null });
  });

  it("« Personnalisé » part du créneau affiché, début facultatif, fin obligatoire", () => {
    const perso = choisirCreneau("perso", choisirCreneau("10-13"));
    expect(perso).toEqual({ cle: "perso", debut: "10:00", fin: "13:00" });
    expect(validerChoix({ cle: "perso", debut: "", fin: "09:30" })).toEqual({ ok: true, creneau: { debut: null, fin: "09:30" } });
    const sansFin = validerChoix({ cle: "perso", debut: "14:00", fin: "" });
    expect(sansFin.ok).toBe(false);
    expect(!sansFin.ok && sansFin.erreur).toMatch(/heure de fin/);
  });
});

describe("validation du créneau", () => {
  it("refuse une fin avant (ou égale à) le début", () => {
    expect(erreurCreneau({ debut: "13:00", fin: "10:00" })).toMatch(/incohérent/);
    expect(erreurCreneau({ debut: "10:00", fin: "10:00" })).toMatch(/incohérent/);
    expect(validerChoix({ cle: "perso", debut: "15:00", fin: "12:00" }).ok).toBe(false);
  });

  it("refuse une heure illisible avec un message au format HH:MM", () => {
    expect(erreurCreneau({ debut: "25:00", fin: "26:00" })).toMatch(/HH:MM/);
    expect(erreurCreneau({ debut: null, fin: "midi" })).toMatch(/fin invalide/);
    expect(erreurCreneau({ debut: null, fin: null })).toMatch(/vide/);
  });

  it("accepte « avant 10 h » et « à partir de 14 h », normalise en HH:MM", () => {
    expect(erreurCreneau({ debut: null, fin: "10:00" })).toBeNull();
    expect(erreurCreneau({ debut: "14:00", fin: null })).toBeNull();
    expect(colonnesCreneau({ debut: "8:30", fin: "11:00:00" })).toEqual({ window_start: "08:30", window_end: "11:00" });
    expect(colonnesCreneau(null)).toEqual({ window_start: null, window_end: null });
  });

  it("schéma partagé POST / PATCH : mêmes règles", () => {
    expect(schemaCreneau.safeParse({ debut: "10:00", fin: "13:00" }).success).toBe(true);
    expect(schemaCreneau.safeParse({ debut: null, fin: "10:00" }).success).toBe(true);
    const refus = schemaCreneau.safeParse({ debut: "13:00", fin: "10:00" });
    expect(refus.success).toBe(false);
    expect(!refus.success && refus.error.issues[0]!.message).toMatch(/fin doit être après/);
    expect(schemaCreneau.nullable().optional().safeParse(null).success).toBe(true);
  });

  it("un créneau enregistré est pris en compte par l'optimisation (prioritaire sur l'annuaire)", () => {
    const { window_start, window_end } = colonnesCreneau({ debut: null, fin: "10:00" });
    const semaine = { "1": [{ open: "08:00", close: "18:00" }] };
    expect(fenetresArret({ semaine, debut: window_start, fin: window_end }, "2026-10-19")).toEqual([[0, 600]]);
  });
});

describe("créneau lu (étiquette, bordereau) pré-sélectionné", () => {
  it("retrouve le bouton rapide correspondant", () => {
    expect(choixDepuisCreneau("10:00", "13:00").cle).toBe("10-13");
    expect(choixDepuisCreneau("12:00:00", "15:00:00").cle).toBe("12-15");
    expect(choixDepuisCreneau(null, "10:00").cle).toBe("avant10");
  });

  it("sinon « Personnalisé » ; « Aucun » si rien ou incohérent", () => {
    expect(choixDepuisCreneau("09:00", "11:30")).toEqual({ cle: "perso", debut: "09:00", fin: "11:30" });
    expect(choixDepuisCreneau(null, null).cle).toBe("aucun");
    expect(choixDepuisCreneau("15:00", "12:00").cle).toBe("aucun");
  });

  it("lecture d'étiquette : créneau gardé seulement s'il est cohérent", () => {
    const base = { adresse: "12 rue des Lilas, 69230 Saint-Genis-Laval", destinataire: null, code: null, telephone: null, poids: null };
    expect(nettoyerEtiquette({ ...base, creneau_debut: "10:00", creneau_fin: "13:00" }).creneau).toEqual({ debut: "10:00", fin: "13:00" });
    expect(nettoyerEtiquette({ ...base, creneau_debut: null, creneau_fin: "10:00" }).creneau).toEqual({ debut: null, fin: "10:00" });
    expect(nettoyerEtiquette({ ...base, creneau_debut: "13:00", creneau_fin: "10:00" }).creneau).toBeUndefined();
    expect("creneau" in nettoyerEtiquette(base)).toBe(false);
  });
});

describe("horaires d'ouverture → suggestion", () => {
  const semaine = {
    "1": [
      { open: "08:15", close: "12:15" },
      { open: "13:30", close: "17:15" },
    ],
    "6": [{ open: "09:00", close: "12:00" }],
    "7": [],
  };

  it("affiche les plages du jour de la tournée", () => {
    // 19/10/2026 : lundi.
    expect(suggestionOuverture(semaine, "2026-10-19")).toEqual({
      libelle: "Ouvert aujourd'hui 8h15–12h15 / 13h30–17h15",
      ferme: false,
      plages: [
        [495, 735],
        [810, 1035],
      ],
    });
    expect(suggestionOuverture(semaine, "2026-10-24", "le 24/10")?.libelle).toBe("Ouvert le 24/10 9h–12h");
  });

  it("fermé ce jour-là, ou jour non renseigné", () => {
    expect(suggestionOuverture(semaine, "2026-10-25")).toEqual({ libelle: "Fermé aujourd'hui", ferme: true, plages: [] });
    expect(suggestionOuverture(semaine, "2026-10-20")).toBeNull();
    expect(suggestionOuverture(null, "2026-10-19")).toBeNull();
  });
});

describe("remise à « Aucun » après chaque ajout", () => {
  it("le dernier choix n'est pas reconduit", () => {
    const apres = creneauApresAjout();
    expect(apres).toEqual({ cle: "aucun", debut: "", fin: "" });
    expect(validerChoix(apres)).toEqual({ ok: true, creneau: null });
    // Copie indépendante : modifier le choix suivant ne touche pas la valeur par défaut.
    apres.fin = "10:00";
    expect(CRENEAU_AUCUN.fin).toBe("");
  });
});
