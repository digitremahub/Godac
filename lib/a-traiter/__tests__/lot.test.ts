import { describe, expect, it } from "vitest";
import {
  LOT_MAX,
  TYPES_LOT,
  actionPossible,
  cleLot,
  commentaireRequis,
  commentaireValide,
  dedoublonner,
  messageResume,
  motifDepuisReponse,
  repartitionParType,
  requeteIndividuelle,
  resultatDepuisReponse,
  resultatRefuse,
  resumer,
} from "@/lib/a-traiter/lot";

const ID = "11111111-1111-4111-8111-111111111111";

describe("actions possibles par type", () => {
  it("valider existe pour tous les types du lot", () => {
    for (const t of TYPES_LOT) expect(actionPossible(t, "valider"), t).toBe(true);
  });

  it("refuser n'existe ni pour l'écart carburant ni pour l'amende (décision à prendre une à une)", () => {
    expect(actionPossible("ecart_carburant", "refuser")).toBe(false);
    expect(actionPossible("amende", "refuser")).toBe(false);
    expect(actionPossible("conge", "refuser")).toBe(true);
    expect(actionPossible("arret", "refuser")).toBe(true);
    expect(actionPossible("entretien", "refuser")).toBe(true);
  });

  it("les types sans traitement individuel groupable sont exclus", () => {
    for (const t of ["ticpe", "tournee_sans_chauffeur", "contestation", "demande", "inscription"]) expect(actionPossible(t, "valider"), t).toBe(false);
  });

  it("le lot est limité à 50 éléments", () => {
    expect(LOT_MAX).toBe(50);
  });
});

describe("commentaire commun", () => {
  it("obligatoire pour justifier un écart et refuser un arrêt, pas pour le reste", () => {
    expect(commentaireRequis("valider", ["ecart_carburant"])).toBe(true);
    expect(commentaireRequis("refuser", ["arret"])).toBe(true);
    expect(commentaireRequis("valider", ["arret", "conge"])).toBe(false);
    expect(commentaireRequis("refuser", ["conge", "entretien"])).toBe(false);
    expect(commentaireRequis("valider", ["conge", "ecart_carburant"])).toBe(true);
  });

  it("3 caractères utiles au moins, 2 000 au plus", () => {
    expect(commentaireValide("  ab ")).toBe(false);
    expect(commentaireValide("ok !")).toBe(true);
    expect(commentaireValide(null)).toBe(false);
    expect(commentaireValide("x".repeat(2001))).toBe(false);
  });
});

describe("requête individuelle équivalente", () => {
  it("écart carburant : justifié avec le commentaire", () => {
    expect(requeteIndividuelle("ecart_carburant", "valider", "  Plein vérifié ")).toEqual({ methode: "POST", corps: { action: "traite", commentaire: "Plein vérifié" } });
    expect(requeteIndividuelle("ecart_carburant", "refuser", "x")).toBeNull();
  });

  it("congé : approuvé / refusé", () => {
    expect(requeteIndividuelle("conge", "valider", null)?.corps).toEqual({ status: "approved" });
    expect(requeteIndividuelle("conge", "refuser", null)?.corps).toEqual({ status: "rejected" });
  });

  it("entretien : pris en charge / annulé", () => {
    expect(requeteIndividuelle("entretien", "valider", null)?.corps).toEqual({ status: "in_progress" });
    expect(requeteIndividuelle("entretien", "refuser", null)?.corps).toEqual({ status: "cancelled" });
  });

  it("arrêt : valider, ou refuser avec le motif commun", () => {
    expect(requeteIndividuelle("arret", "valider", null)?.corps).toEqual({ action: "valider" });
    expect(requeteIndividuelle("arret", "refuser", "Pièce illisible")?.corps).toEqual({ action: "refuser", motif: "Pièce illisible" });
  });

  it("amende : confirme le responsable suggéré", () => {
    expect(requeteIndividuelle("amende", "valider", null)).toEqual({ methode: "PATCH", corps: { action: "valider" } });
    expect(requeteIndividuelle("amende", "refuser", null)).toBeNull();
  });
});

describe("doublons", () => {
  it("retire les éléments répétés, en gardant l'ordre", () => {
    const r = dedoublonner([
      { type: "conge" as const, id: "a" },
      { type: "arret" as const, id: "a" },
      { type: "conge" as const, id: "a" },
      { type: "conge" as const, id: "b" },
    ]);
    expect(r.map(cleLot)).toEqual(["conge:a", "arret:a", "conge:b"]);
  });
});

describe("résultat par élément", () => {
  const el = { type: "conge" as const, id: ID };

  it("une réponse 2xx est un succès", () => {
    expect(resultatDepuisReponse(el, 200, { leaveRequest: {} })).toEqual({ cle: `conge:${ID}`, type: "conge", id: ID, ok: true });
  });

  it("un refus garde le motif de la route individuelle", () => {
    const r = resultatDepuisReponse(el, 403, { error: "Vous ne pouvez pas décider de votre propre demande." });
    expect(r.ok).toBe(false);
    expect(r.motif).toBe("Vous ne pouvez pas décider de votre propre demande.");
  });

  it("motif par défaut selon le statut quand la réponse n'en donne pas (ou donne un objet de validation)", () => {
    expect(motifDepuisReponse(404, null)).toMatch(/introuvable/i);
    expect(motifDepuisReponse(403, { error: { fieldErrors: {} } })).toMatch(/non autorisée/i);
    expect(motifDepuisReponse(400, {})).toMatch(/invalides/i);
    expect(motifDepuisReponse(503, {})).toMatch(/base/i);
    expect(motifDepuisReponse(500, undefined)).toMatch(/échoué/i);
  });

  it("un refus décidé avant l'appel", () => {
    expect(resultatRefuse(el, "Déjà traité")).toMatchObject({ ok: false, motif: "Déjà traité" });
  });

  it("résume sans tout annuler : réussis et refusés se comptent séparément", () => {
    const resultats = [resultatDepuisReponse(el, 200, {}), resultatDepuisReponse({ type: "conge", id: "b" }, 403, { error: "non" }), resultatDepuisReponse({ type: "conge", id: "c" }, 200, {})];
    const r = resumer(resultats);
    expect(r).toEqual({ total: 3, reussis: 2, refuses: 1 });
    expect(messageResume(r)).toBe("2 traités, 1 refusé (voir le détail).");
  });

  it("messages de synthèse", () => {
    expect(messageResume({ total: 0, reussis: 0, refuses: 0 })).toBe("Aucun élément traité.");
    expect(messageResume({ total: 1, reussis: 1, refuses: 0 })).toBe("1 élément traité.");
    expect(messageResume({ total: 4, reussis: 4, refuses: 0 })).toBe("4 éléments traités.");
    expect(messageResume({ total: 3, reussis: 0, refuses: 3 })).toMatch(/rien n'a été modifié/);
  });

  it("répartition par type pour le journal, sans donnée personnelle", () => {
    expect(repartitionParType([{ type: "conge" }, { type: "conge" }, { type: "arret" }])).toEqual({ conge: 2, arret: 1 });
  });
});

describe("litrage cumulé avant validation en lot", () => {
  it("additionne les litres des écarts carburant et liste les véhicules", async () => {
    const { resumeLitrage, phraseLitrage } = await import("@/lib/a-traiter/lot");
    const r = resumeLitrage([
      { type: "ecart_carburant", litres: 40.25, vehicule: "AB-1" },
      { type: "ecart_carburant", litres: 10, vehicule: "AB-1" },
      { type: "ecart_carburant", litres: null, vehicule: "CD-2" },
      { type: "conge", litres: 99, vehicule: "ZZ" },
    ]);
    expect(r).toEqual({ ecarts: 3, litres: 50.3, vehicules: ["AB-1", "CD-2"] });
    expect(phraseLitrage(r)).toContain("2 véhicules");
    expect(phraseLitrage(resumeLitrage([]))).toBe("");
  });
});
