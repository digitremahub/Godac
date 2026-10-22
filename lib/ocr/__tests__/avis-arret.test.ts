import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { corpsLectureAvis, lireAvisArret, lireReponseAvis } from "../avis-arret";

const ORIGINAL_ENV = process.env.ANTHROPIC_API_KEY;
afterEach(() => {
  process.env.ANTHROPIC_API_KEY = ORIGINAL_ENV;
  vi.unstubAllGlobals();
});

const reponse = (input: object) => ({ content: [{ type: "tool_use", name: "avis_arret", input }] });

describe("lecture de l'avis d'arrêt", () => {
  it("outil imposé, sans réflexion, sortie courte, sans réglage d'échantillonnage", () => {
    const c = corpsLectureAvis("AAAA", "avis.jpg");
    expect(c).toMatchObject({ model: "claude-sonnet-5", thinking: { type: "disabled" }, tool_choice: { type: "tool", name: "avis_arret" } });
    expect(c.max_tokens).toBeLessThanOrEqual(500);
    expect(c).not.toHaveProperty("temperature");
    expect(c).not.toHaveProperty("top_p");
    expect(c).not.toHaveProperty("top_k");
    // Le schéma ne demande aucun champ médical.
    const props = Object.keys((c.tools as { input_schema: { properties: object } }[])[0]!.input_schema.properties);
    expect(props.sort()).toEqual(["au", "du", "lisible", "prolongation", "type", "volet_medical"]);
    expect(corpsLectureAvis("AAAA", "avis.pdf").messages).toEqual([expect.objectContaining({ content: expect.arrayContaining([expect.objectContaining({ type: "document" })]) })]);
  });

  it("dates, type et prolongation", () => {
    const r = lireReponseAvis(reponse({ lisible: true, volet_medical: false, type: "maladie", prolongation: true, du: "2026-10-05", au: "2026-10-09" }));
    expect(r).toEqual({ ok: true, champs: { lisible: true, volet_medical: false, type: "maladie", prolongation: true, du: "2026-10-05", au: "2026-10-09" } });
  });

  it("volet médical : aucun champ conservé ; champ inattendu ignoré", () => {
    const r = lireReponseAvis(reponse({ lisible: true, volet_medical: true, type: "maladie", prolongation: false, du: "2026-10-05", au: "2026-10-09", motif: "x" }));
    expect(r).toEqual({ ok: true, champs: { lisible: true, volet_medical: true, type: null, prolongation: null, du: null, au: null } });
    expect(JSON.stringify(r)).not.toContain("motif");
  });

  it("dates mal formées ou incohérentes écartées", () => {
    const r = lireReponseAvis(reponse({ lisible: true, volet_medical: false, type: null, prolongation: null, du: "05/10/2026", au: "2026-10-01" }));
    expect(r.ok && r.champs).toMatchObject({ du: null, au: "2026-10-01" });
    const r2 = lireReponseAvis(reponse({ lisible: true, volet_medical: false, type: "at_mp", prolongation: false, du: "2026-10-05", au: "2026-10-01" }));
    expect(r2.ok && r2.champs.au).toBeNull();
  });

  it("réponse sans outil ou API en erreur : échec propre, jamais d'exception", async () => {
    expect(lireReponseAvis({ content: [{ type: "text" }] }).ok).toBe(false);
    process.env.ANTHROPIC_API_KEY = "test";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("surcharge", { status: 529 })));
    expect((await lireAvisArret(Buffer.from("x"), "a.jpg")).ok).toBe(false);
    delete process.env.ANTHROPIC_API_KEY;
    expect((await lireAvisArret(Buffer.from("x"), "a.jpg")).ok).toBe(false);
  });
});
