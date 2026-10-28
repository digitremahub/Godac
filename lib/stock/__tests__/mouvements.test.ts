import { describe, expect, it } from "vitest";
import { dateValide, normaliserCode, nouvelleCle, schemaMouvement, validerMouvement, type EntreeMouvement } from "@/lib/stock/mouvements";
import type { CleProfil } from "@/lib/stock/profils";

const SITE = "11111111-1111-4111-8111-111111111111";
const ART = "22222222-2222-4222-8222-222222222222";
const EMP1 = "33333333-3333-4333-8333-333333333333";
const EMP2 = "44444444-4444-4444-8444-444444444444";
const base = { cle: "cle-test-0001", site_id: SITE };
const lire = (e: Record<string, unknown>) => schemaMouvement.parse({ ...base, ...e }) as EntreeMouvement;
const valider = (e: Record<string, unknown>, profils: CleProfil[] = ["messagerie", "palettes", "vrac"], role = "chauffeur") => validerMouvement(lire(e), { profils, role });

describe("code lu ou saisi", () => {
  it("retire les caractères de contrôle et les espaces superflus", () => {
    expect(normaliserCode("  AB 12\u001d34  ")).toBe("AB 1234");
    expect(normaliserCode("")).toBeNull();
    expect(normaliserCode("x".repeat(81))).toBeNull();
    expect(normaliserCode(12)).toBeNull();
  });
  it("date réelle uniquement", () => {
    expect(dateValide("2026-02-28")).toBe(true);
    expect(dateValide("2026-02-30")).toBe(false);
    expect(dateValide("28/02/2026")).toBe(false);
  });
  it("clé d'idempotence : préfixe, unique, 100 caractères au plus", () => {
    const a = nouvelleCle("mvt");
    expect(a.startsWith("mvt-")).toBe(true);
    expect(nouvelleCle("mvt")).not.toBe(a);
    expect(a.length).toBeLessThanOrEqual(100);
    expect(a.length).toBeGreaterThanOrEqual(8);
  });
});

describe("validation d'un mouvement d'unité", () => {
  it("entrée d'un colis : type d'unité requis", () => {
    expect(valider({ type: "entree", code: "COLIS0001" })).toEqual({ ok: false, erreur: "Choisissez le type d'unité (colis ou palette)." });
    const r = valider({ type: "entree", code: " COLIS0001 ", type_unite: "colis", poids_kg: 2.5, emplacement_dest_id: EMP1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.params).toMatchObject({ p_unite_code: "COLIS0001", p_type_unite: "colis", p_quantite: 1, p_dest: EMP1, p_poids: 2.5, p_article: null, p_source: "app", p_sens: null });
    }
  });

  it("sortie, transfert et retour d'une unité connue : pas de type nécessaire", () => {
    expect(valider({ type: "sortie", code: "COLIS0001" }).ok).toBe(true);
    expect(valider({ type: "transfert", code: "COLIS0001", emplacement_dest_id: EMP2 }).ok).toBe(true);
    expect(valider({ type: "retour", code: "COLIS0001", statut_apres: "dans_depot", emplacement_dest_id: EMP1 }).ok).toBe(true);
  });

  it("un transfert exige la destination", () => {
    expect(valider({ type: "transfert", code: "COLIS0001" })).toEqual({ ok: false, erreur: "Choisissez l'emplacement de destination." });
  });

  it("casse, perte et ajustement exigent un motif", () => {
    for (const type of ["casse", "perte"]) expect(valider({ type, code: "C12345" })).toEqual({ ok: false, erreur: "Indiquez le motif." });
    expect(valider({ type: "casse", code: "C12345", motif: "Colis écrasé" }).ok).toBe(true);
    expect(valider({ type: "ajustement", code: "C12345", sens: 1, type_unite: "colis" }, undefined, "manager")).toEqual({ ok: false, erreur: "Indiquez le motif." });
  });

  it("l'ajustement est refusé au chauffeur et doit porter un sens", () => {
    expect(valider({ type: "ajustement", code: "C12345", sens: 1, type_unite: "colis", motif: "Trouvé" }, undefined, "chauffeur")).toEqual({ ok: false, erreur: "Un ajustement est réservé à l'encadrement." });
    expect(valider({ type: "ajustement", code: "C12345", motif: "x" }, undefined, "manager")).toEqual({ ok: false, erreur: "Un ajustement doit indiquer s'il ajoute ou retire du stock." });
    const ok = valider({ type: "ajustement", code: "C12345", sens: -1, motif: "Perdu" }, undefined, "exploitation");
    expect(ok.ok && ok.params.p_sens).toBe(-1);
  });

  it("statut demandé : seulement ceux qui ont un sens pour le mouvement", () => {
    expect(valider({ type: "sortie", code: "C12345", statut_apres: "retour" })).toEqual({ ok: false, erreur: "Statut demandé impossible pour ce mouvement." });
    expect(valider({ type: "entree", code: "C12345", type_unite: "colis", statut_apres: "livre" }).ok).toBe(false);
  });

  it("le type d'unité doit être permis par les profils actifs", () => {
    expect(valider({ type: "entree", code: "PAL0001", type_unite: "palette_eur" }, ["messagerie"])).toEqual({ ok: false, erreur: "Ce type d'unité n'est pas activé dans les paramètres du stock." });
    expect(valider({ type: "entree", code: "PAL0001", type_unite: "palette_eur" }, ["palettes"]).ok).toBe(true);
  });

  it("SSCC : normalisé ou refusé", () => {
    const ok = valider({ type: "entree", code: "PAL0001", type_unite: "palette_eur", sscc: "(00)376104250000000013" }, ["palettes"]);
    expect(ok.ok && ok.params.p_sscc).toBe("376104250000000013");
    expect(valider({ type: "entree", code: "PAL0001", type_unite: "palette_eur", sscc: "123" }, ["palettes"])).toEqual({ ok: false, erreur: "SSCC invalide : 18 chiffres attendus." });
  });

  it("lot et date limite ne concernent pas les unités", () => {
    expect(valider({ type: "entree", code: "C12345", type_unite: "colis", lot: "L1" }).ok).toBe(false);
  });

  it("sans profil activé : refus explicite", () => {
    const r = valider({ type: "entree", code: "C12345", type_unite: "colis" }, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreur).toMatch(/Aucun profil/);
  });

  it("un code ou un article, jamais les deux ni aucun", () => {
    expect(valider({ type: "sortie" }).ok).toBe(false);
    expect(valider({ type: "sortie", code: "C12345", article_id: ART, quantite: 1 }).ok).toBe(false);
  });

  it("le suivi des colis doit être activé pour un code", () => {
    expect(valider({ type: "sortie", code: "C12345" }, ["vrac"])).toEqual({ ok: false, erreur: "Le suivi des colis et des palettes n'est pas activé dans les paramètres du stock." });
  });
});

describe("validation d'un mouvement d'article", () => {
  it("quantité requise, arrondie au millième, positive", () => {
    expect(valider({ type: "entree", article_id: ART })).toEqual({ ok: false, erreur: "Indiquez la quantité." });
    expect(() => lire({ type: "entree", article_id: ART, quantite: 0 })).toThrow();
    expect(() => lire({ type: "entree", article_id: ART, quantite: -3 })).toThrow();
    const r = valider({ type: "entree", article_id: ART, quantite: 2.00049, emplacement_dest_id: EMP1, lot: " L42 ", dlc: "2027-03-01" });
    expect(r.ok && r.params).toMatchObject({ p_article: ART, p_quantite: 2, p_lot: "L42", p_dlc: "2027-03-01", p_unite_code: null });
  });

  it("DLC invalide refusée", () => {
    expect(valider({ type: "entree", article_id: ART, quantite: 1, dlc: "2027-13-40" })).toEqual({ ok: false, erreur: "Date limite invalide." });
  });

  it("le profil « vrac » doit être activé", () => {
    expect(valider({ type: "entree", article_id: ART, quantite: 1 }, ["messagerie"])).toEqual({ ok: false, erreur: "Le suivi des marchandises en vrac n'est pas activé dans les paramètres du stock." });
  });

  it("transfert entre deux emplacements : identiques refusés", () => {
    expect(valider({ type: "transfert", article_id: ART, quantite: 2, emplacement_source_id: EMP1, emplacement_dest_id: EMP1 })).toEqual({ ok: false, erreur: "L'origine et la destination sont identiques." });
    expect(valider({ type: "transfert", article_id: ART, quantite: 2, emplacement_source_id: EMP1, emplacement_dest_id: EMP2 }).ok).toBe(true);
  });

  it("motif trop long refusé", () => {
    const r = valider({ type: "casse", article_id: ART, quantite: 1, motif: "x".repeat(301) });
    expect(r.ok).toBe(false);
  });

  it("la clé d'idempotence est transmise telle quelle à la fonction SQL", () => {
    const r = valider({ type: "sortie", article_id: ART, quantite: 1, cle: "rejeu-hors-ligne-42" });
    expect(r.ok && r.params.p_cle).toBe("rejeu-hors-ligne-42");
  });
});
