import { describe, expect, it } from "vitest";
import { ecransVisibles, horsOffreGoNavigation, MARQUEUR_GO_NAVIGATION, ongletsSection, premierOngletSection } from "@/lib/acces/catalogue";
import { boutonsBarreMobile } from "@/lib/acces/barre-mobile";
import { ECRANS_GO_NAVIGATION } from "@/lib/go-navigation/offre";

const modulesGo = new Set(["route_optimizer", "mobile_app", "alerts", "auth_onboarding", MARQUEUR_GO_NAVIGATION]);

describe("menu réduit des comptes GO Navigation", () => {
  it("manager qui conduit : Tournée colis, historique colis, Mon compte et Aide seulement", () => {
    const ids = ecransVisibles("manager", modulesGo, true).map((e) => e.id);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(ECRANS_GO_NAVIGATION).toContain(id);
    expect(ids).toContain("exploitation.colis");
    expect(ids).toContain("aide.compte");
    expect(ids).not.toContain("dashboard.accueil");
    expect(ids).not.toContain("carburant.pleins");
    expect(ids).not.toContain("equipe.utilisateurs");
  });

  it("sans marqueur, mêmes modules : le menu classique reste plus large", () => {
    const sans = new Set([...modulesGo].filter((m) => m !== MARQUEUR_GO_NAVIGATION));
    const ids = ecransVisibles("manager", sans, true).map((e) => e.id);
    expect(ids).toContain("dashboard.accueil");
    expect(ids).toContain("carburant.pleins");
  });

  it("onglets et lien de section restent dans le périmètre", () => {
    for (const o of ongletsSection("exploitation", "manager", modulesGo, true)) expect(ECRANS_GO_NAVIGATION).toContain(o.id);
    expect(premierOngletSection("carburant", "manager", modulesGo, true)).toBeNull();
    expect(horsOffreGoNavigation("dashboard.accueil", modulesGo)).toBe(true);
    expect(horsOffreGoNavigation("exploitation.colis", modulesGo)).toBe(false);
    expect(horsOffreGoNavigation("dashboard.accueil", new Set(["route_optimizer"]))).toBe(false);
  });

  it("barre mobile : Tournée et GO Nav, sans Plein", () => {
    const b = boutonsBarreMobile("manager", modulesGo, false, true);
    expect(b.map((x) => x.libelle)).toEqual(["Tournée", "GO Nav"]);
    expect(b.map((x) => x.href)).toContain("/livreur/navigation");
  });
});
