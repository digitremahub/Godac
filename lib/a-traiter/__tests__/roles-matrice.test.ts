import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ECRANS_PAR_TYPE, ROLES_A_TRAITER, TYPES_A_TRAITER, TYPES_MANAGER, typeVisiblePour, typesVisiblesPour, type TypeATraiter } from "@/lib/a-traiter/logique";
import { ECRAN_PAR_TYPE_LOT, TYPES_LOT, typeLotAutorise } from "@/lib/a-traiter/lot";
import { ecranOuvrable } from "@/lib/acces/tuiles-accueil";
import { MODULES_AVEC_CODE } from "@/lib/acces/catalogue";
import type { UserRole } from "@/lib/types/domain";

/**
 * Matrice des droits de « À traiter » par rôle et par type d'élément
 * (audit des rôles du lot 1 « exploitation »). Tous les modules sont
 * actifs : seule la règle de rôle est testée.
 */
const MODULES = new Set<string>(MODULES_AVEC_CODE);
const ctx = (role: UserRole, conduit = false) => ({ role, modules: MODULES, conduit });

/** Types réellement lus par le serveur pour ce rôle : type autorisé ET écran du catalogue ouvert. */
function typesLus(role: UserRole): TypeATraiter[] {
  if (!ecranOuvrable("dashboard.a_traiter", ctx(role)) || !ROLES_A_TRAITER.includes(role)) return [];
  return TYPES_A_TRAITER.filter((t) => typeVisiblePour(t, role) && ECRANS_PAR_TYPE[t].some((e) => ecranOuvrable(e, ctx(role))));
}

describe("À traiter : types lus par rôle", () => {
  it("chauffeur : rien", () => {
    expect(typesLus("chauffeur")).toEqual([]);
    expect(ecranOuvrable("dashboard.a_traiter", ctx("chauffeur"))).toBe(false);
    expect(ecranOuvrable("dashboard.a_traiter", ctx("chauffeur", true))).toBe(false);
  });

  it("comptable : rien (hors chaîne, pas de liste de décisions)", () => {
    expect(typesLus("comptable")).toEqual([]);
    expect(ecranOuvrable("dashboard.a_traiter", ctx("comptable"))).toBe(false);
    // Même appelé directement, le type reste refusé : arrêts de travail et paie ne sont pas pour lui ici.
    for (const t of TYPES_A_TRAITER) expect(typeVisiblePour(t, "comptable"), t).toBe(false);
  });

  it("manager / chef d'équipe : carburant, tickets, entretien, congés, tournées ; jamais paie, arrêts, amendes, contestations, TICPE, inscriptions, demandes", () => {
    expect(typesLus("manager")).toEqual([...TYPES_MANAGER].sort((a, b) => TYPES_A_TRAITER.indexOf(a) - TYPES_A_TRAITER.indexOf(b)));
    for (const t of ["bulletin_paie", "arret", "amende", "contestation", "ticpe", "inscription", "demande"] as const) expect(typeVisiblePour(t, "manager"), t).toBe(false);
    // Le chef d'équipe qui conduit n'a pas plus de droits.
    expect(typesVisiblesPour("manager")).toEqual(typesLus("manager"));
  });

  it("exploitation : toute l'organisation, mais jamais la paie", () => {
    const lus = typesLus("exploitation");
    expect(lus).not.toContain("bulletin_paie");
    expect(lus).toContain("arret");
    expect(lus).toContain("ticket_ocr");
    expect(lus).toContain("ecart_carburant");
    expect(lus.length).toBe(TYPES_A_TRAITER.length - 1);
    expect(typeVisiblePour("bulletin_paie", "exploitation")).toBe(false);
  });

  it("direction : tout, paie comprise", () => {
    expect(typesLus("direction")).toEqual([...TYPES_A_TRAITER]);
  });

  it("la paie n'est ouverte qu'à la direction et au comptable dans le catalogue", () => {
    for (const role of ["chauffeur", "manager", "exploitation"] as const) expect(ecranOuvrable("equipe.paie", ctx(role)), role).toBe(false);
    expect(ecranOuvrable("equipe.paie", ctx("direction"))).toBe(true);
    expect(ecranOuvrable("equipe.paie", ctx("comptable"))).toBe(true);
  });
});

describe("À traiter : chaque source lit l'écran déclaré dans la matrice", () => {
  const source = readFileSync("lib/a-traiter/serveur.ts", "utf8");
  const blocs = [...source.matchAll(/type: "([a-z_]+)",\s*\n\s*nom: "[^"]+",\s*\n\s*ecran: "([a-z_.]+)"/g)];

  it("tous les types ont au moins une source", () => {
    expect(new Set(blocs.map((b) => b[1]))).toEqual(new Set(TYPES_A_TRAITER));
  });

  it("l'écran de chaque source est celui de la matrice", () => {
    for (const [, type, ecran] of blocs) expect(ECRANS_PAR_TYPE[type as TypeATraiter], `${type} → ${ecran}`).toContain(ecran);
  });
});

describe("Actions groupées : périmètre par rôle", () => {
  it("manager : carburant, entretien, congés seulement", () => {
    const ok = TYPES_LOT.filter((t) => typeLotAutorise(t, ctx("manager")));
    expect(ok.sort()).toEqual(["conge", "ecart_carburant", "entretien"]);
  });

  it("exploitation et direction : tous les types du lot", () => {
    for (const role of ["exploitation", "direction"] as const) expect(TYPES_LOT.filter((t) => typeLotAutorise(t, ctx(role))), role).toEqual([...TYPES_LOT]);
  });

  it("chauffeur et comptable : aucun type", () => {
    for (const role of ["chauffeur", "comptable"] as const) expect(TYPES_LOT.filter((t) => typeLotAutorise(t, ctx(role))), role).toEqual([]);
  });

  it("un module absent ferme le type (entretien sans module)", () => {
    const sans = { role: "exploitation" as const, modules: new Set<string>(), conduit: false };
    expect(typeLotAutorise("entretien", sans)).toBe(false);
    expect(typeLotAutorise("ecart_carburant", sans)).toBe(true);
  });

  it("chaque type du lot a son écran", () => {
    for (const t of TYPES_LOT) expect(ECRANS_PAR_TYPE[t]).toContain(ECRAN_PAR_TYPE_LOT[t]);
  });
});
