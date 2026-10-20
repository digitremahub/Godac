import { describe, expect, it } from "vitest";
import {
  ECRANS_GO_NAVIGATION,
  essaiTermine,
  estOffreGoNavigation,
  expirationInvitation,
  finEssai,
  formulaireInscriptionSchema,
  invitationUtilisable,
  joursRestants,
  MODULES_GO_NAVIGATION,
  nomOrganisation,
  normaliserNote,
  PLAFONDS_ESSAI,
  statutInvitation,
} from "@/lib/go-navigation/offre";
import { existeEcran, MODULES_AVEC_CODE, MODULES_SANS_CODE } from "@/lib/acces/catalogue";
import { USAGE_FEATURES } from "@/lib/usage/quotas";

const T0 = new Date("2026-10-20T10:00:00Z");
const JOUR = 24 * 3600 * 1000;

describe("fin d'essai", () => {
  it("30 jours après l'inscription", () => {
    expect(finEssai(T0).toISOString()).toBe("2026-11-19T10:00:00.000Z");
  });

  it("essai en cours, terminé à la seconde de fin, ignoré hors offre GO Navigation", () => {
    const org = { offre: "go_navigation", subscription_status: "trialing", trial_ends_at: finEssai(T0).toISOString() };
    expect(essaiTermine(org, new Date(T0.getTime() + 29 * JOUR))).toBe(false);
    expect(essaiTermine(org, finEssai(T0))).toBe(true);
    expect(essaiTermine({ ...org, offre: null }, new Date(T0.getTime() + 90 * JOUR))).toBe(false);
  });

  it("un compte passé sur une vraie offre (abonnement actif) n'est plus bloqué", () => {
    expect(essaiTermine({ offre: "go_navigation", subscription_status: "active", trial_ends_at: "2020-01-01T00:00:00Z" }, T0)).toBe(false);
  });

  it("sans date de fin : bloqué (jamais d'accès illimité par oubli)", () => {
    expect(essaiTermine({ offre: "go_navigation", subscription_status: "trialing", trial_ends_at: null }, T0)).toBe(true);
    expect(essaiTermine(null, T0)).toBe(false);
  });

  it("jours restants arrondis au supérieur", () => {
    const fin = finEssai(T0);
    expect(joursRestants(fin, T0)).toBe(30);
    expect(joursRestants(fin, new Date(fin.getTime() - 3600 * 1000))).toBe(1);
    expect(joursRestants(fin, new Date(fin.getTime() + 1))).toBe(0);
    expect(joursRestants(null, T0)).toBe(0);
  });

  it("reconnaît l'offre", () => {
    expect(estOffreGoNavigation({ offre: "go_navigation" })).toBe(true);
    expect(estOffreGoNavigation({ offre: null })).toBe(false);
  });
});

describe("invitations", () => {
  const base = { expires_at: expirationInvitation(T0).toISOString(), used_at: null, revoked_at: null };

  it("expire 30 jours après sa création", () => {
    expect(new Date(base.expires_at).getTime() - T0.getTime()).toBe(30 * JOUR);
  });

  it("statuts : envoyée, utilisée, expirée, révoquée", () => {
    expect(statutInvitation(base, T0)).toBe("envoyee");
    expect(statutInvitation(base, new Date(T0.getTime() + 30 * JOUR))).toBe("expiree");
    expect(statutInvitation({ ...base, revoked_at: T0.toISOString() }, T0)).toBe("revoquee");
    expect(statutInvitation({ ...base, used_at: T0.toISOString() }, T0)).toBe("utilisee");
    // Utilisée puis expirée : reste « utilisée ».
    expect(statutInvitation({ ...base, used_at: T0.toISOString() }, new Date(T0.getTime() + 60 * JOUR))).toBe("utilisee");
  });

  it("utilisable seulement si envoyée", () => {
    expect(invitationUtilisable(base, T0)).toBe(true);
    expect(invitationUtilisable({ ...base, used_at: T0.toISOString() }, T0)).toBe(false);
    expect(invitationUtilisable({ ...base, revoked_at: T0.toISOString() }, T0)).toBe(false);
    expect(invitationUtilisable({ ...base, expires_at: "pas une date" }, T0)).toBe(false);
    expect(invitationUtilisable(null, T0)).toBe(false);
  });

  it("note normalisée et bornée", () => {
    expect(normaliserNote("  pour Jean,\n Transports X ")).toBe("pour Jean, Transports X");
    expect(normaliserNote("   ")).toBeNull();
    expect(normaliserNote(undefined)).toBeNull();
    expect(normaliserNote("x".repeat(300))).toHaveLength(200);
  });
});

describe("modules et plafonds", () => {
  it("Tournée colis + appli chauffeur, sans module OCR carburant ni autre module payant", () => {
    expect(MODULES_GO_NAVIGATION).toContain("route_optimizer");
    expect(MODULES_GO_NAVIGATION).toContain("mobile_app");
    expect(MODULES_GO_NAVIGATION).not.toContain("ocr");
    expect(MODULES_GO_NAVIGATION).not.toContain("planning");
    for (const m of MODULES_GO_NAVIGATION) {
      expect([...MODULES_AVEC_CODE, ...MODULES_SANS_CODE] as string[]).toContain(m);
    }
  });

  it("3 000 lectures d'étiquettes et 300 optimisations par mois", () => {
    const par = Object.fromEntries(PLAFONDS_ESSAI.map((p) => [p.feature, p]));
    expect(par.ocr_label?.included_per_month).toBe(3000);
    expect(par.route_optimization?.included_per_month).toBe(300);
    for (const p of PLAFONDS_ESSAI) {
      expect(USAGE_FEATURES as readonly string[]).toContain(p.feature);
      expect(p.daily_cap).toBeGreaterThan(0);
      expect(p.daily_cap).toBeLessThanOrEqual(p.included_per_month);
    }
  });

  it("écrans de l'offre : tous connus du catalogue", () => {
    for (const id of ECRANS_GO_NAVIGATION) expect(existeEcran(id)).toBe(true);
  });
});

describe("formulaire d'inscription", () => {
  const ok = { jeton: "x".repeat(43), prenom: " Jean ", nom: "Dupont", email: " Jean@Exemple.FR ", motDePasse: "motdepasse-solide", cgu: true };

  it("valide et normalise l'e-mail", () => {
    const r = formulaireInscriptionSchema.safeParse(ok);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.email).toBe("jean@exemple.fr");
      expect(r.data.prenom).toBe("Jean");
    }
  });

  it("refuse CGU non acceptées, mot de passe court, e-mail invalide", () => {
    expect(formulaireInscriptionSchema.safeParse({ ...ok, cgu: false }).success).toBe(false);
    expect(formulaireInscriptionSchema.safeParse({ ...ok, motDePasse: "court" }).success).toBe(false);
    expect(formulaireInscriptionSchema.safeParse({ ...ok, email: "pas-un-email" }).success).toBe(false);
  });

  it("nom de l'organisation", () => {
    expect(nomOrganisation(" Jean ", "Dupont ")).toBe("GO Navigation – Jean Dupont");
  });
});
