import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { creerFileConfirmation, indexFocusSuivant, normaliserOptions } from "@/lib/ui/confirmation";

describe("boîte de confirmation : options", () => {
  it("valeurs par défaut : titre, bouton d'action, Annuler", () => {
    expect(normaliserOptions("Supprimer ?")).toMatchObject({ titre: "Confirmer", message: "Supprimer ?", action: "Confirmer", annuler: "Annuler", danger: false });
    expect(normaliserOptions({ message: "C'est définitif.", danger: true })).toMatchObject({ titre: "Confirmer la suppression", action: "Supprimer", danger: true });
    expect(normaliserOptions({ titre: "  Retirer cet arrêt ? ", message: " x ", action: "Retirer" })).toMatchObject({ titre: "Retirer cet arrêt ?", message: "x", action: "Retirer" });
  });
});

describe("boîte de confirmation : file d'attente", () => {
  it("confirme, annule, et n'affiche qu'une demande à la fois", async () => {
    const f = creerFileConfirmation();
    let notifications = 0;
    f.abonner(() => notifications++);
    expect(f.courante()).toBeNull();
    const a = f.demander({ message: "A" });
    const b = f.demander({ message: "B", danger: true });
    expect(f.taille()).toBe(2);
    expect(f.courante()?.message).toBe("A");
    const idA = f.courante()!.id;
    f.repondre(idA, true);
    await expect(a).resolves.toBe(true);
    expect(f.courante()?.message).toBe("B");
    // Réponse tardive à une demande déjà traitée : ignorée.
    f.repondre(idA, true);
    expect(f.taille()).toBe(1);
    f.repondre(f.courante()!.id, false);
    await expect(b).resolves.toBe(false);
    expect(f.courante()).toBeNull();
    expect(notifications).toBe(4);
  });

  it("hôte monté ou non (repli sur window.confirm sans boîte)", () => {
    const f = creerFileConfirmation();
    expect(f.aUnHote()).toBe(false);
    const retirer = f.enregistrerHote();
    expect(f.aUnHote()).toBe(true);
    retirer();
    expect(f.aUnHote()).toBe(false);
  });
});

describe("boîte de confirmation : piège à focus", () => {
  it("Tab boucle du dernier au premier, Maj+Tab du premier au dernier", () => {
    expect(indexFocusSuivant(2, 0, false)).toBe(1);
    expect(indexFocusSuivant(2, 1, false)).toBe(0);
    expect(indexFocusSuivant(2, 0, true)).toBe(1);
    expect(indexFocusSuivant(3, 2, true)).toBe(1);
  });
  it("focus hors de la boîte : ramené au premier (ou au dernier en arrière)", () => {
    expect(indexFocusSuivant(2, -1, false)).toBe(0);
    expect(indexFocusSuivant(2, -1, true)).toBe(1);
    expect(indexFocusSuivant(0, -1, false)).toBe(-1);
  });
});

describe("plus de window.confirm dans l'application", () => {
  const racine = path.resolve(__dirname, "../../..");
  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = path.join(dir, n);
      if (statSync(p).isDirectory()) return n === "__tests__" || n === "node_modules" ? [] : sources(p);
      return /\.tsx?$/.test(n) ? [p] : [];
    });

  it("toutes les confirmations passent par confirmer()", () => {
    for (const f of [...sources(path.join(racine, "app")), ...sources(path.join(racine, "components"))]) {
      const s = readFileSync(f, "utf8");
      expect(/(?<![.\w])(window\.)?confirm\(/.test(s), path.relative(racine, f)).toBe(false);
    }
  });

  it("la boîte est montée une fois, dans le layout racine", () => {
    expect(readFileSync(path.join(racine, "app/layout.tsx"), "utf8")).toContain("<BoiteConfirmation />");
    const boite = readFileSync(path.join(racine, "components/ui/BoiteConfirmation.tsx"), "utf8");
    for (const attendu of ['role="alertdialog"', 'aria-modal="true"', "aria-labelledby", "aria-describedby", '"Escape"', '"Tab"', "min-h-[44px]"]) expect(boite).toContain(attendu);
  });
});
