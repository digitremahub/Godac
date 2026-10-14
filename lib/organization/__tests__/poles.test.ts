import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  POLES,
  POLES_BUREAU,
  POLE_KEYS,
  estPole,
  estPoleBureau,
  estPresence,
  grouperParPole,
  heuresPresence,
  libelleServiceAvecPole,
  numeroPresence,
  poleDe,
} from "@/lib/organization/poles";

describe("pôles standard", () => {
  it("liste fixe, exploitation en tête, clés uniques", () => {
    expect(POLE_KEYS).toEqual(["exploitation", "direction", "administratif", "secretariat", "comptabilite", "rh", "atelier", "commercial", "qualite"]);
    expect(new Set(POLE_KEYS).size).toBe(POLES.length);
    expect(POLES.filter((p) => p.operationnel).map((p) => p.key)).toEqual(["exploitation"]);
    expect(POLES_BUREAU).toHaveLength(8);
  });

  it("alignée sur la contrainte et la fonction de la migration", () => {
    const sql = readFileSync(path.resolve(__dirname, "../../../supabase/migrations/20260101000126_poles_standard.sql"), "utf8");
    for (const p of POLES) expect(sql).toContain(`'${p.key}'`);
    for (const p of POLES_BUREAU) expect(sql).toContain(`('${p.key}', '${p.label}')`);
  });

  it("valeurs inconnues → exploitation", () => {
    expect(poleDe(undefined).key).toBe("exploitation");
    expect(poleDe("n'importe quoi").key).toBe("exploitation");
    expect(poleDe("rh").label).toBe("Ressources humaines");
    expect(estPole("comptabilite")).toBe(true);
    expect(estPole("compta")).toBe(false);
    expect(estPoleBureau("secretariat")).toBe(true);
    expect(estPoleBureau(null)).toBe(false);
  });

  it("regroupe dans l'ordre des pôles et omet les pôles vides", () => {
    const groupes = grouperParPole([
      { name: "Comptabilité", pole: "comptabilite" },
      { name: "Longue distance", pole: "exploitation" },
      { name: "Messagerie", pole: null },
      { name: "Direction", pole: "direction" },
    ]);
    expect(groupes.map((g) => g.pole.key)).toEqual(["exploitation", "direction", "comptabilite"]);
    expect(groupes[0]!.services.map((s) => s.name)).toEqual(["Longue distance", "Messagerie"]);
  });

  it("libellés de service", () => {
    expect(libelleServiceAvecPole({ name: "Longue distance", pole: "exploitation" })).toBe("Longue distance");
    expect(libelleServiceAvecPole({ name: "Secrétariat", pole: "secretariat" })).toBe("Secrétariat");
    expect(libelleServiceAvecPole({ name: "Accueil Lyon", pole: "secretariat" })).toBe("Secrétariat · Accueil Lyon");
  });

  it("présences : repère stable, détection, durée", () => {
    const n = numeroPresence("1b2c3d4e-0000-0000-0000-000000000000");
    expect(n).toBe("PRESENCE-1b2c3d4e-0000-0000-0000-000000000000");
    // Même motif que les numéros automatiques exclus des suggestions de tournées.
    expect(/^.{8}-/.test(n)).toBe(true);
    expect(estPresence({ kind: "presence" })).toBe(true);
    expect(estPresence({ status: "presence" })).toBe(true);
    expect(estPresence({ tour_number: n })).toBe(true);
    expect(estPresence({ kind: "tournee", status: "done", tour_number: "T106" })).toBe(false);
    expect(heuresPresence("2026-10-12T07:00:00Z", "2026-10-12T15:30:00Z")).toBe(8.5);
    expect(heuresPresence("2026-10-12T07:00:00Z", null)).toBe(0);
    expect(heuresPresence("2026-10-12T07:00:00Z", "2026-10-12T06:00:00Z")).toBe(0);
  });
});
