import { describe, expect, it } from "vitest";
import { ECRANS, MODULES_AVEC_CODE, SECTIONS, TOUS_LES_ROLES, deciderAcces, menuPour } from "@/lib/acces/catalogue";

/** Instantané relu : qui ouvre quoi (✅ menu, 🔒 accès sans entrée de menu, — refusé), tous modules actifs. */
function matrice(): string {
  const tout = new Set<string>(MODULES_AVEC_CODE);
  const menus = Object.fromEntries(TOUS_LES_ROLES.map((r) => [r, new Set(menuPour(r, tout).flatMap((s) => s.ecrans.map((e) => e.id)))]));
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
