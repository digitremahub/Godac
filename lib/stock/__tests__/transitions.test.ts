import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import fixture from "./transitions-sql.json";
import {
  STATUTS_UNITE,
  TYPES_MOUVEMENT,
  mouvementsPossibles,
  sensDe,
  statutApres,
  transitionAutorisee,
  type StatutUnite,
  type TypeMouvement,
} from "@/lib/stock/transitions";

const SQL = readFileSync("supabase/migrations/20261114000002_stock_fonctions.sql", "utf8");
const bloc = () => {
  const i = SQL.indexOf("create or replace function public.stock_transition_autorisee");
  const j = SQL.indexOf("$$;", SQL.indexOf("as $$", i)) + 3;
  return SQL.slice(i, j).replace(/\s+/g, " ").trim();
};

describe("transitions de statut : alignées sur la fonction SQL", () => {
  it("la fonction SQL n'a pas changé depuis la génération de la table de référence", () => {
    expect(createHash("sha256").update(bloc()).digest("hex"), "régénérer transitions-sql.json après toute modification de stock_transition_autorisee").toBe(fixture.sha256);
  });

  it("toutes les combinaisons (type, sens, avant, après) donnent le même résultat qu'en SQL", () => {
    const attendu = new Set(fixture.autorisees.map((l) => JSON.stringify(l)));
    const avants: (StatutUnite | null)[] = [null, ...STATUTS_UNITE];
    let compte = 0;
    for (const type of TYPES_MOUVEMENT) {
      for (const sens of [-1, 0, 1]) {
        for (const avant of avants) {
          for (const apres of STATUTS_UNITE) {
            const ts = transitionAutorisee(type, sens, avant, apres);
            expect(ts, `${type} ${sens} ${avant} → ${apres}`).toBe(attendu.has(JSON.stringify([type, sens, avant, apres])));
            if (ts) compte++;
          }
        }
      }
    }
    expect(compte).toBe(fixture.autorisees.length);
  });
});

describe("statut après un mouvement", () => {
  it("entrée : en dépôt ; casse : endommagée ; perte : perdue", () => {
    expect(statutApres("entree", null)).toBe("dans_depot");
    expect(statutApres("casse", "dans_depot")).toBe("endommage");
    expect(statutApres("perte", "en_tournee")).toBe("perdu");
  });
  it("sortie : en tournée si une tournée est liée, sinon livrée ; choix explicite respecté", () => {
    expect(statutApres("sortie", "dans_depot", { tournee: true })).toBe("en_tournee");
    expect(statutApres("sortie", "dans_depot", { tournee: false })).toBe("livre");
    expect(statutApres("sortie", "en_tournee", { demande: "livre" })).toBe("livre");
  });
  it("retour : « retour » par défaut, ou remise en stock", () => {
    expect(statutApres("retour", "en_tournee")).toBe("retour");
    expect(statutApres("retour", "en_tournee", { demande: "dans_depot" })).toBe("dans_depot");
  });
  it("transfert : statut inchangé ; ajustement : suit le sens", () => {
    expect(statutApres("transfert", "retour")).toBe("retour");
    expect(statutApres("ajustement", "perdu", { sens: 1 })).toBe("dans_depot");
    expect(statutApres("ajustement", "dans_depot", { sens: -1 })).toBe("perdu");
    expect(statutApres("ajustement", "dans_depot", {})).toBeNull();
  });
});

describe("parcours complets d'un colis", () => {
  const enchainer = (etapes: { type: TypeMouvement; options?: Parameters<typeof statutApres>[2] }[]) => {
    let statut: StatutUnite | null = null;
    for (const e of etapes) {
      const sens = sensDe(e.type, e.options?.sens ?? null);
      const apres = statutApres(e.type, statut, e.options);
      expect(transitionAutorisee(e.type, sens, statut, apres), `${e.type} depuis ${statut}`).toBe(true);
      statut = apres;
    }
    return statut;
  };

  it("entrée → chargement → livraison", () => {
    expect(enchainer([{ type: "entree" }, { type: "sortie", options: { tournee: true } }, { type: "sortie", options: { demande: "livre" } }])).toBe("livre");
  });
  it("entrée → chargement → échec → rentrée en stock → nouvelle tournée", () => {
    expect(
      enchainer([
        { type: "entree" },
        { type: "sortie", options: { tournee: true } },
        { type: "retour" },
        { type: "retour", options: { demande: "dans_depot" } },
        { type: "sortie", options: { tournee: true } },
      ]),
    ).toBe("en_tournee");
  });
  it("une unité livrée ne peut pas être transférée ni cassée ; une unité en stock ne peut pas être entrée deux fois", () => {
    expect(transitionAutorisee("transfert", 0, "livre", "livre")).toBe(false);
    expect(transitionAutorisee("casse", -1, "livre", "endommage")).toBe(false);
    expect(transitionAutorisee("entree", 1, "dans_depot", "dans_depot")).toBe(false);
  });
});

describe("mouvements proposés selon le statut", () => {
  it("inconnue : seulement une entrée", () => {
    expect(mouvementsPossibles(null)).toEqual(["entree"]);
  });
  it("en dépôt : sortie, transfert, casse, perte", () => {
    expect(mouvementsPossibles("dans_depot")).toEqual(["sortie", "transfert", "casse", "perte"]);
  });
  it("en tournée : sortie (remise), retour, casse, perte", () => {
    expect(mouvementsPossibles("en_tournee")).toEqual(["sortie", "retour", "casse", "perte"]);
  });
  it("livrée : entrée (retour client) et retour", () => {
    expect(mouvementsPossibles("livre")).toEqual(["entree", "retour"]);
  });
});
