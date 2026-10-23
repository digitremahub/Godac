import { describe, expect, it } from "vitest";
import { cleEntreprise } from "@/lib/recommandation/entreprise";
import { recommandationSchema, MAX_RECOMMANDATIONS_PAR_JOUR } from "@/lib/recommandation/formulaire";
import { chaleurPiste, grouperPistes, type LigneRecommandation } from "@/lib/recommandation/chaleur";
import { TEXTE_CONSENTEMENT, texteConsentementEnregistre } from "@/lib/recommandation/consentement";
import { EDITEUR } from "@/lib/legal/editeur";

describe("cleEntreprise", () => {
  it("minuscules, sans accents, espaces réduits", () => {
    expect(cleEntreprise("  Transports   Hélène  ")).toBe("transports helene");
  });
  it("retire les formes juridiques, avec ou sans points", () => {
    expect(cleEntreprise("Transports Dupont S.A.R.L.")).toBe("transports dupont");
    expect(cleEntreprise("transports  DUPONT sarl")).toBe("transports dupont");
    expect(cleEntreprise("SAS Dupont Express")).toBe("dupont express");
    expect(cleEntreprise("Dupont Express, SASU")).toBe("dupont express");
  });
  it("regroupe les variantes de ponctuation", () => {
    expect(cleEntreprise("Martin & Fils")).toBe(cleEntreprise("martin et fils"));
    expect(cleEntreprise("Dupont-Express")).toBe("dupont express");
  });
  it("ne vide pas un nom réduit à une forme juridique", () => {
    expect(cleEntreprise("SARL")).toBe("sarl");
  });
  it("vide pour une entrée vide", () => {
    expect(cleEntreprise(null)).toBe("");
  });
});

const base = { companyName: "Transports Dupont", contactEmail: "rh@exemple.fr", consent: true as const };

describe("recommandationSchema", () => {
  it("accepte un formulaire minimal avec e-mail", () => {
    const r = recommandationSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.contactPhone).toBeNull();
      expect(r.data.contactName).toBeNull();
    }
  });
  it("accepte un téléphone seul, normalisé", () => {
    const r = recommandationSchema.safeParse({ companyName: "Dupont", contactPhone: "0612345678", consent: true });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.contactPhone).toBe("06 12 34 56 78");
  });
  it("refuse sans e-mail ni téléphone", () => {
    expect(recommandationSchema.safeParse({ companyName: "Dupont", consent: true }).success).toBe(false);
    expect(recommandationSchema.safeParse({ companyName: "Dupont", contactEmail: "  ", consent: true }).success).toBe(false);
  });
  it("refuse un e-mail ou un téléphone invalide", () => {
    expect(recommandationSchema.safeParse({ ...base, contactEmail: "pas-un-mail" }).success).toBe(false);
    expect(recommandationSchema.safeParse({ companyName: "Dupont", contactPhone: "abc", consent: true }).success).toBe(false);
  });
  it("nom d'entreprise : 2 à 120 caractères", () => {
    expect(recommandationSchema.safeParse({ ...base, companyName: "A" }).success).toBe(false);
    expect(recommandationSchema.safeParse({ ...base, companyName: "A".repeat(121) }).success).toBe(false);
    expect(recommandationSchema.safeParse({ ...base, companyName: "A".repeat(120) }).success).toBe(true);
  });
  it("message : 500 caractères maximum", () => {
    expect(recommandationSchema.safeParse({ ...base, message: "x".repeat(501) }).success).toBe(false);
    expect(recommandationSchema.safeParse({ ...base, message: "x".repeat(500) }).success).toBe(true);
  });
  it("le consentement doit être exactement true", () => {
    expect(recommandationSchema.safeParse({ ...base, consent: false }).success).toBe(false);
    expect(recommandationSchema.safeParse({ ...base, consent: "true" }).success).toBe(false);
    const { consent: _c, ...sans } = base;
    expect(recommandationSchema.safeParse(sans).success).toBe(false);
  });
  it("limite quotidienne : 5", () => {
    expect(MAX_RECOMMANDATIONS_PAR_JOUR).toBe(5);
  });
});

describe("chaleur et regroupement", () => {
  it("1 tiède, 2 chaude, 3 et plus très chaude", () => {
    expect(chaleurPiste(1)).toBe("tiede");
    expect(chaleurPiste(2)).toBe("chaude");
    expect(chaleurPiste(3)).toBe("tres_chaude");
    expect(chaleurPiste(7)).toBe("tres_chaude");
  });
  const l = (id: string, user: string | null, cle: string, date: string): LigneRecommandation => ({
    id,
    referrer_user_id: user,
    company_name: cle,
    company_key: cle,
    status: "nouvelle",
    created_at: date,
  });
  it("compte les chauffeurs distincts et classe les pistes chaudes d'abord", () => {
    const pistes = grouperPistes([
      l("1", "a", "recente seule", "2026-11-05T10:00:00Z"),
      l("2", "a", "dupont", "2026-11-01T10:00:00Z"),
      l("3", "b", "dupont", "2026-11-02T10:00:00Z"),
      l("4", "b", "dupont", "2026-11-03T10:00:00Z"),
    ]);
    expect(pistes.map((p) => p.companyKey)).toEqual(["dupont", "recente seule"]);
    expect(pistes[0]!.chauffeurs).toBe(2);
    expect(pistes[0]!.chaleur).toBe("chaude");
    expect(pistes[0]!.lignes[0]!.id).toBe("4");
    expect(pistes[1]!.chaleur).toBe("tiede");
  });
  it("un chauffeur supprimé compte à part", () => {
    const [p] = grouperPistes([l("1", null, "x", "2026-11-01T00:00:00Z"), l("2", null, "x", "2026-11-02T00:00:00Z")]);
    expect(p!.chauffeurs).toBe(2);
  });
});

describe("consentement", () => {
  it("mentionne l'adresse de contact de l'éditeur et le retrait de l'accord", () => {
    expect(TEXTE_CONSENTEMENT).toContain(EDITEUR.email);
    expect(TEXTE_CONSENTEMENT).toContain("retirer mon accord");
    expect(texteConsentementEnregistre()).toContain(TEXTE_CONSENTEMENT);
  });
});
