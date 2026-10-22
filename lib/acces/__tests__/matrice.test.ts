import { describe, expect, it } from "vitest";
import { ECRANS, MODULES_AVEC_CODE, SECTIONS, TOUS_LES_ROLES, deciderAcces, menuPour, ongletsMonEspace } from "@/lib/acces/catalogue";

/**
 * Instantané relu : qui ouvre quoi (✅ menu ou onglet de Mon espace, 🔒
 * accès sans entrée de menu, ↪ renvoi vers un autre écran, — refusé),
 * tous modules actifs.
 */
function matrice(): string {
  const tout = new Set<string>(MODULES_AVEC_CODE);
  const menus = Object.fromEntries(
    TOUS_LES_ROLES.map((r) => [r, new Set([...menuPour(r, tout).flatMap((s) => s.ecrans.map((e) => e.id)), ...ongletsMonEspace(r, tout).flatMap((g) => g.onglets.map((o) => o.id))])]),
  );
  const lignes = ["| Section | Écran | URL | " + TOUS_LES_ROLES.join(" | ") + " | Modules |", "|" + "---|".repeat(TOUS_LES_ROLES.length + 4)];
  for (const s of SECTIONS) {
    for (const e of ECRANS.filter((x) => x.section === s.id)) {
      const cases = TOUS_LES_ROLES.map((r) => (menus[r]!.has(e.id) ? "✅" : deciderAcces(e, r, tout).ok ? "🔒" : e.alternative?.[r] ? `↪ ${e.alternative[r]}` : "—"));
      const mods = [...(e.modules ?? []), ...(e.modulesAuMoinsUn ?? []).map((m) => `${m}?`)].join(", ");
      lignes.push(`| ${s.libelle} | ${e.libelle} | \`${e.href}\` | ${cases.join(" | ")} | ${mods || "—"} |`);
    }
  }
  return lignes.join("\n") + "\n";
}

describe("matrice rôles × écrans", () => {
  it("correspond à l'instantané relu", async () => {
    await expect(matrice()).toMatchFileSnapshot("./__snapshots__/matrice-roles-ecrans.md");
  });
});

describe("rôle exploitation : entre le manager et la direction", () => {
  const tout = new Set<string>(MODULES_AVEC_CODE);
  const ouverts = (role: Parameters<typeof deciderAcces>[1], conduit = false) => new Set(ECRANS.filter((e) => deciderAcces(e, role, tout, conduit).ok).map((e) => e.id));

  it("ouvre tout ce qu'ouvre un manager (qui conduit ou non)", () => {
    for (const conduit of [false, true]) {
      const exploitation = ouverts("exploitation", conduit);
      for (const id of ouverts("manager", conduit)) expect(exploitation.has(id), id).toBe(true);
    }
  });

  it("ajoute le reporting et la TICPE (lecture et export)", () => {
    const manager = ouverts("manager");
    const exploitation = ouverts("exploitation");
    const enPlus = [...exploitation].filter((id) => !manager.has(id)).sort();
    expect(enPlus).toEqual(["carburant.ticpe", "carburant.ticpe_detail", "dashboard.reporting"]);
  });

  it("n'ouvre ni paie, ni facturation, ni réglages, ni audit, ni registre", () => {
    const exploitation = ouverts("exploitation");
    const reserves = ECRANS.filter((e) => e.id.startsWith("equipe.paie") || e.id.startsWith("admin.") || ["equipe.heures", "equipe.registre"].includes(e.id));
    for (const e of reserves) {
      if (e.id === "admin.faq") continue; // contrôle réel : administrateur plateforme GODAC
      expect(exploitation.has(e.id), e.id).toBe(false);
    }
    // Ses propres bulletins et acomptes restent accessibles, comme pour un manager.
    expect(exploitation.has("moi.fiches_paie")).toBe(true);
    expect(exploitation.has("moi.acomptes")).toBe(true);
  });

  it("tout ce qu'ouvre l'exploitation, la direction l'ouvre aussi (hors écrans de conduite et « Mon espace » salarié)", () => {
    const direction = ouverts("direction");
    // Écrans de conduite (Mon espace, GO Navigation) : la direction ne conduit pas.
    const horsDirection = [...ouverts("exploitation", true)].filter((id) => !direction.has(id) && !id.startsWith("moi.") && !ECRANS.find((e) => e.id === id)?.conducteur);
    expect(horsDirection).toEqual([]);
  });
});
