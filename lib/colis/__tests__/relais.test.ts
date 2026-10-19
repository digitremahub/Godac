import { describe, expect, it } from "vitest";
import {
  LIEUX_LIVRAISON,
  estMarque,
  estPointRelais,
  libelleFait,
  libelleLieu,
  libellePreuve,
  libelleRetours,
  libelleStatut,
  refusPreuve,
  relaisObligatoire,
  typeArret,
} from "@/lib/colis/livraison";
import { NOM_RELAIS_MAX, RETOURS_MAX, arretARejoindre, lireRetours, normaliserNomRelais, typeApresRegroupement } from "@/lib/colis/relais";
import { motifsPour } from "@/lib/colis/cloture";

describe("type d'arrêt point relais", () => {
  it("lu en base", () => {
    expect(typeArret("point_relais")).toBe("point_relais");
    expect(typeArret("ramasse")).toBe("ramasse");
    expect(typeArret("inconnu")).toBe("livraison");
    expect(estPointRelais({ kind: "point_relais" })).toBe(true);
    expect(estPointRelais({ kind: "ramasse" })).toBe(false);
    expect(estMarque({ kind: "point_relais" })).toBe(true);
    expect(estMarque({ kind: "ramasse" })).toBe(true);
    expect(estMarque({ kind: "livraison" })).toBe(false);
    expect(estMarque({})).toBe(false);
  });
  it("libellés de statut et d'action", () => {
    expect(libelleStatut({ kind: "point_relais", status: "delivered" })).toBe("Déposé au relais");
    expect(libelleStatut({ kind: "point_relais", status: "failed" })).toBe("Dépôt au relais manqué");
    expect(libelleStatut({ kind: "point_relais", status: "pending" })).toBe("Dépôt au relais non fait");
    expect(libelleStatut({ kind: "livraison", status: "delivered" })).toBe("Livré");
    expect(libelleFait({ kind: "point_relais" })).toBe("Déposé au relais");
    expect(libelleFait({ kind: "ramasse" })).toBe("Ramassé");
    expect(libelleFait({ kind: null })).toBe("Livré");
  });
  it("motifs d'échec d'un point relais", () => {
    const relais = motifsPour("point_relais").map((m) => m.key);
    expect(relais).toContain("relais_complet");
    expect(relais).toContain("ferme");
    expect(relais).not.toContain("absent");
    expect(relais).not.toContain("refuse");
    expect(relais).not.toContain("rien_a_ramasser");
    expect(motifsPour("livraison").map((m) => m.key)).not.toContain("relais_complet");
    expect(motifsPour(true).map((m) => m.key)).not.toContain("relais_complet");
    expect(motifsPour("ramasse").map((m) => m.key)).toEqual(motifsPour(true).map((m) => m.key));
  });
});

describe("remise au point relais", () => {
  it("mode de remise", () => {
    expect(relaisObligatoire("point_relais")).toBe(true);
    expect(LIEUX_LIVRAISON.filter((l) => relaisObligatoire(l.key)).map((l) => l.key)).toEqual(["point_relais"]);
    expect(libelleLieu("point_relais")).toBe("Au point relais");
  });
  it("preuve : nom du relais et photo ou code", () => {
    expect(refusPreuve({ lieu: "point_relais", photo: false, code: null, relais: null })).toMatch(/nom ou l'adresse du point relais/);
    expect(refusPreuve({ lieu: "point_relais", photo: false, code: null, relais: "Tabac de la Gare" })).toMatch(/photo ou scannez/);
    expect(refusPreuve({ lieu: "point_relais", photo: true, code: null, relais: "Tabac de la Gare" })).toBeNull();
    expect(refusPreuve({ lieu: "point_relais", photo: false, code: "R123", relais: "Tabac de la Gare" })).toBeNull();
  });
  it("les autres modes gardent leurs règles", () => {
    expect(refusPreuve({ lieu: "main_propre", photo: false, code: null, relais: null })).toBeNull();
    expect(refusPreuve({ lieu: "boite_aux_lettres", photo: false, code: null, relais: null })).toMatch(/Photo obligatoire/);
    expect(refusPreuve({ lieu: "qr_code", photo: true, code: null, relais: null })).toMatch(/QR code/);
    expect(refusPreuve({ lieu: "qr_code", photo: false, code: "ABC", relais: null })).toBeNull();
  });
  it("preuve lisible", () => {
    expect(libellePreuve({ delivered_place: "point_relais", relay_name: "Pickup Tabac de la Gare", proof_code: "R123" })).toBe(
      "Remis au point relais Pickup Tabac de la Gare (code R123)",
    );
    expect(libellePreuve({ delivered_place: "point_relais", kind: "point_relais", relay_name: "Relais Colis Presse", returns_count: 2 })).toBe(
      "Déposé au relais Relais Colis Presse · 2 retours repris",
    );
    expect(libellePreuve({ delivered_place: "point_relais", kind: "point_relais", returns_count: 1 })).toBe("Déposé au relais · 1 retour repris");
    expect(libellePreuve({ delivered_place: "point_relais", kind: "point_relais", returns_count: 0 })).toBe("Déposé au relais");
    expect(libellePreuve({ delivered_place: "qr_code", proof_code: "ABC" })).toBe("Avec QR code (ABC)");
  });
  it("retours", () => {
    expect(libelleRetours(0)).toBeNull();
    expect(libelleRetours(null)).toBeNull();
    expect(libelleRetours(3)).toBe("3 retours repris");
    expect(lireRetours("3")).toBe(3);
    expect(lireRetours(" 2 ")).toBe(2);
    expect(lireRetours(0)).toBe(0);
    expect(lireRetours("")).toBeNull();
    expect(lireRetours("abc")).toBeNull();
    expect(lireRetours(-1)).toBeNull();
    expect(lireRetours(2.7)).toBe(2);
    expect(lireRetours(10_000)).toBe(RETOURS_MAX);
  });
  it("nom du relais", () => {
    expect(normaliserNomRelais("  Mondial   Relay\n Tabac ")).toBe("Mondial Relay Tabac");
    expect(normaliserNomRelais("   ")).toBeNull();
    expect(normaliserNomRelais(null)).toBeNull();
    expect(normaliserNomRelais("x".repeat(300))).toHaveLength(NOM_RELAIS_MAX);
  });
});

describe("regroupement à la même adresse", () => {
  it("types compatibles", () => {
    expect(typeApresRegroupement("point_relais", "livraison")).toBe("point_relais");
    expect(typeApresRegroupement("livraison", "point_relais")).toBe("point_relais");
    expect(typeApresRegroupement("point_relais", "point_relais")).toBe("point_relais");
    expect(typeApresRegroupement("livraison", "livraison")).toBe("livraison");
    expect(typeApresRegroupement("ramasse", "ramasse")).toBe("ramasse");
    expect(typeApresRegroupement("ramasse", "livraison")).toBeNull();
    expect(typeApresRegroupement("point_relais", "ramasse")).toBeNull();
  });
  it("un colis scanné rejoint l'arrêt point relais de son adresse, dans la même liste", () => {
    const stops = [
      { id: "a", status: "pending", list_id: null, kind: "livraison", cle: "1 rue x" },
      { id: "b", status: "pending", list_id: null, kind: "point_relais", cle: "1 rue x" },
      { id: "c", status: "pending", list_id: null, kind: "ramasse", cle: "1 rue x" },
      { id: "d", status: "delivered", list_id: null, kind: "point_relais", cle: "2 rue y" },
      { id: "e", status: "pending", list_id: "L2", kind: "point_relais", cle: "3 rue z" },
    ];
    expect(arretARejoindre(stops, { listId: null, cle: "1 rue x", type: "livraison" })?.id).toBe("b");
    expect(arretARejoindre(stops, { listId: null, cle: "1 rue x", type: "point_relais" })?.id).toBe("b");
    expect(arretARejoindre(stops, { listId: null, cle: "1 rue x", type: "ramasse" })?.id).toBe("c");
    expect(arretARejoindre(stops, { listId: null, cle: "2 rue y", type: "livraison" })).toBeNull();
    expect(arretARejoindre(stops, { listId: null, cle: "3 rue z", type: "livraison" })).toBeNull();
    expect(arretARejoindre(stops, { listId: "L2", cle: "3 rue z", type: "livraison" })?.id).toBe("e");
  });
  it("un point relais créé à l'adresse d'une livraison la reprend", () => {
    const stops = [{ id: "a", status: "pending", list_id: null, kind: null, cle: "1 rue x" }];
    expect(arretARejoindre(stops, { listId: null, cle: "1 rue x", type: "point_relais" })?.id).toBe("a");
    expect(arretARejoindre(stops, { listId: null, cle: "1 rue x", type: "ramasse" })).toBeNull();
  });
});
