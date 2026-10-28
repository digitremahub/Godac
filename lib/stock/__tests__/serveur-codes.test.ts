import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/organization/modules", () => ({ isModuleEnabled: async () => true }));
const journal: { action: string; details?: Record<string, unknown> }[] = [];
vi.mock("@/lib/audit/journal", () => ({ journaliser: async (p: { action: string; details?: Record<string, unknown> }) => void journal.push(p), ACTIONS_AUDIT: {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: () => null }));

import { genererCodesInternes } from "@/lib/stock/codes-serveur";
import { produireEtiquettes, schemaImpression } from "@/lib/stock/etiquettes-serveur";
import { appelerMouvement, lireParametresStock } from "@/lib/stock/serveur";
import { completerUnite, trouverUniteParCode, unitesParIds } from "@/lib/stock/unites-serveur";
import type { ParametresRpcMouvement } from "@/lib/stock/mouvements";
import { fakeDb } from "../../planning/__tests__/_fake-db";

const ORG = "o1";
const USER = { id: "u1", organization_id: ORG };
const rpc = (reponse: { data?: unknown; error?: { code?: string; message: string } | null }, appels: { nom: string; params: Record<string, unknown> }[] = []) =>
  ({ rpc: (nom: string, params: Record<string, unknown>) => (appels.push({ nom, params }), Promise.resolve({ data: reponse.data ?? null, error: reponse.error ?? null })) }) as never;

beforeEach(() => {
  journal.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("génération de codes (serveur)", () => {
  it("appelle la fonction SQL avec le nombre et la clé, journalise le nombre et les bornes (pas la liste)", async () => {
    const appels: { nom: string; params: Record<string, unknown> }[] = [];
    const r = await genererCodesInternes(rpc({ data: { ok: true, doublon: false, codes: ["TRA-2026-000001", "TRA-2026-000002", "TRA-2026-000003"], prefixe: "TRA", annee: 2026 } }, appels), USER, 3, "cle-test-0001", "planche");
    expect(r).toEqual({ ok: true, doublon: false, codes: ["TRA-2026-000001", "TRA-2026-000002", "TRA-2026-000003"], prefixe: "TRA", annee: 2026 });
    expect(appels).toEqual([{ nom: "stock_generer_codes", params: { p_nombre: 3, p_cle: "cle-test-0001" } }]);
    expect(journal).toEqual([{ organizationId: ORG, userId: "u1", action: "stock_codes_generes", targetTable: "stock_generations", details: { nombre: 3, premier: "TRA-2026-000001", dernier: "TRA-2026-000003", origine: "planche" } }]);
  });
  it("rejeu de la même clé (doublon) : mêmes codes, pas de nouvelle ligne de journal", async () => {
    const r = await genererCodesInternes(rpc({ data: { ok: true, doublon: true, codes: ["TRA-2026-000001"], prefixe: "TRA", annee: 2026 } }), USER, 1, "cle-test-0001", "api");
    expect(r).toMatchObject({ ok: true, doublon: true });
    expect(journal).toHaveLength(0);
  });
  it("erreurs traduites en français avec leur statut : limite, rôle, module", async () => {
    expect(await genererCodesInternes(rpc({ error: { message: "stock_limite_depassee" } }), USER, 501, "cle-test-0001", "api")).toMatchObject({ ok: false, erreur: { code: "stock_limite_depassee", status: 400 } });
    expect(await genererCodesInternes(rpc({ error: { message: "stock_role_refuse" } }), USER, 1, "cle-test-0001", "api")).toMatchObject({ ok: false, erreur: { status: 403 } });
    expect(await genererCodesInternes(rpc({ error: { message: "stock_module_inactif" } }), USER, 1, "cle-test-0001", "api")).toMatchObject({ ok: false, erreur: { status: 403 } });
    expect(journal).toHaveLength(0);
  });
  it("fonction absente (migration non appliquée) : 503 clair", async () => {
    expect(await genererCodesInternes(rpc({ error: { code: "PGRST202", message: "Could not find the function" } }), USER, 1, "cle-test-0001", "api")).toMatchObject({ ok: false, erreur: { code: "stock_schema_absent", status: 503 } });
  });
});

describe("paramètres : profils, personnalisation, préfixe, format", () => {
  const lecture = (reponses: { data?: unknown; error?: { code?: string; message: string } | null }[]) => {
    const colonnes: string[] = [];
    return {
      colonnes,
      db: {
        from: () => ({
          select: (c: string) => {
            colonnes.push(c);
            const r = reponses[Math.min(colonnes.length - 1, reponses.length - 1)]!;
            return { eq: () => ({ maybeSingle: () => Promise.resolve({ data: r.data ?? null, error: r.error ?? null }) }) };
          },
        }),
      } as never,
    };
  };
  it("lit les profils de la configuration, le préfixe et le format", async () => {
    const { db } = lecture([{ data: { profils: ["messagerie"], prefixe_code: "TMF", format_etiquette: "a4_2x4", profils_config: { version: 1, actifs: ["sante", "pharmacie"], profils: { sante: { vocabulaire: { un: "poche", plusieurs: "poches" } } } } } }]);
    const p = await lireParametresStock(db, ORG);
    expect(p).toMatchObject({ profils: ["sante", "pharmacie"], prefixe: "TMF", formatEtiquette: "a4_2x4", codesInstalles: true, schemaAbsent: false });
    expect(p.config.profils.sante?.vocabulaire?.un).toBe("poche");
  });
  it("configuration vide : les profils viennent de la colonne historique", async () => {
    const { db } = lecture([{ data: { profils: ["palettes", "vrac"], prefixe_code: null, format_etiquette: null, profils_config: {} } }]);
    expect(await lireParametresStock(db, ORG)).toMatchObject({ profils: ["palettes", "vrac"], prefixe: null, formatEtiquette: null, codesInstalles: true });
  });
  it("format ou configuration abîmés : valeurs sûres, aucune exception", async () => {
    const { db } = lecture([{ data: { profils: ["vrac"], prefixe_code: "X", format_etiquette: "a3", profils_config: "n'importe quoi" } }]);
    expect(await lireParametresStock(db, ORG)).toMatchObject({ profils: ["vrac"], formatEtiquette: null });
  });
  it("migrations des codes pas appliquées (colonnes absentes) : relit les profils historiques seulement", async () => {
    const { db, colonnes } = lecture([{ error: { code: "42703", message: "column stock_parametres.prefixe_code does not exist" } }, { data: { profils: ["messagerie"] } }]);
    const p = await lireParametresStock(db, ORG);
    expect(p).toMatchObject({ profils: ["messagerie"], codesInstalles: false, schemaAbsent: false, prefixe: null });
    expect(colonnes).toEqual(["profils, prefixe_code, format_etiquette, profils_config", "profils"]);
  });
  it("PostgREST : « Could not find the column » est traité comme une colonne absente", async () => {
    const { db } = lecture([{ error: { code: "PGRST204", message: "Could not find the 'profils_config' column of 'stock_parametres' in the schema cache" } }, { data: { profils: [] } }]);
    expect(await lireParametresStock(db, ORG)).toMatchObject({ codesInstalles: false, schemaAbsent: false });
  });
  it("table absente : schéma absent", async () => {
    const { db } = lecture([{ error: { code: "42P01", message: "relation does not exist" } }]);
    expect(await lireParametresStock(db, ORG)).toMatchObject({ schemaAbsent: true, codesInstalles: false, profils: [] });
  });
});

describe("mouvement : fonction v2 pour l'application, fonction d'origine pour les tournées", () => {
  const base: ParametresRpcMouvement = {
    p_cle: "cle-test-0001", p_type: "entree", p_site: "s1", p_unite_code: "C1", p_type_unite: "colis", p_article: null, p_quantite: 1, p_src: null, p_dest: null, p_lot: null, p_dlc: null,
    p_sens: null, p_statut_apres: null, p_motif: null, p_run: null, p_stop: null, p_poids: null, p_volume: null, p_sscc: null, p_source: "app",
  };
  it("l'application (profil, code interne, attributs) appelle stock_enregistrer_mouvement_v2", async () => {
    const appels: { nom: string; params: Record<string, unknown> }[] = [];
    const r = await appelerMouvement(rpc({ data: { ok: true, doublon: false, mouvement_id: "m1", unite_id: "u1", statut: "dans_depot", code: "C1", code_interne: "TRA-2026-000001" } }, appels), { ...base, p_profil: "messagerie", p_code_interne: "TRA-2026-000001", p_attributs: { fragile: true } });
    expect(appels[0]!.nom).toBe("stock_enregistrer_mouvement_v2");
    expect(r).toMatchObject({ ok: true, uniteId: "u1", code: "C1", codeInterne: "TRA-2026-000001" });
  });
  it("les liens avec les tournées (sans ces champs) gardent la fonction d'origine", async () => {
    const appels: { nom: string; params: Record<string, unknown> }[] = [];
    await appelerMouvement(rpc({ data: { ok: true, doublon: false } }, appels), { ...base, p_source: "tournee" });
    expect(appels[0]!.nom).toBe("stock_enregistrer_mouvement");
    expect(appels[0]!.params).not.toHaveProperty("p_profil");
  });
  it("v2 absente (migrations pas appliquées) et rien de nouveau demandé : repli sur la fonction d'origine, sans les champs nouveaux", async () => {
    const appels: { nom: string; params: Record<string, unknown> }[] = [];
    const db = {
      rpc: (nom: string, params: Record<string, unknown>) => {
        appels.push({ nom, params });
        return Promise.resolve(nom.endsWith("_v2") ? { data: null, error: { code: "PGRST202", message: "Could not find the function public.stock_enregistrer_mouvement_v2" } } : { data: { ok: true, doublon: false, mouvement_id: "m1" }, error: null });
      },
    } as never;
    const r = await appelerMouvement(db, { ...base, p_profil: null, p_code_interne: null, p_attributs: null });
    expect(r).toMatchObject({ ok: true });
    expect(appels.map((a) => a.nom)).toEqual(["stock_enregistrer_mouvement_v2", "stock_enregistrer_mouvement"]);
    expect(Object.keys(appels[1]!.params)).not.toContain("p_attributs");
  });
  it("v2 absente mais un code interne ou des attributs sont demandés : erreur 503 claire, aucun repli silencieux", async () => {
    const db = { rpc: () => Promise.resolve({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }) } as never;
    expect(await appelerMouvement(db, { ...base, p_code_interne: "TRA-2026-000001" })).toMatchObject({ ok: false, status: 503 });
    expect(await appelerMouvement(db, { ...base, p_attributs: { fragile: true } })).toMatchObject({ ok: false, status: 503 });
  });
  it("champ obligatoire manquant (refus de la base) : message nommant le champ", async () => {
    const r = await appelerMouvement(rpc({ error: { message: "stock_champ_requis_temperature" } }), { ...base, p_profil: "sante" });
    expect(r).toMatchObject({ ok: false, status: 400, message: expect.stringContaining("Température cible") });
  });
  it("code ambigu : 409 clair", async () => {
    expect(await appelerMouvement(rpc({ error: { message: "stock_code_ambigu" } }), { ...base, p_code_interne: "TRA-2026-000001" })).toMatchObject({ ok: false, status: 409 });
  });
});

describe("recherche d'une unité par code principal ou code interne", () => {
  const unites = [
    { id: "x1", organization_id: ORG, code: "003456789012345678", code_interne: "TRA-2026-000001", type_unite: "colis", statut: "dans_depot", nature: "colis", fragile: true, poids_kg: "2.500" },
    { id: "x2", organization_id: ORG, code: "COLIS-2", code_interne: "", type_unite: "colis", statut: "livre" },
    { id: "x3", organization_id: "autre", code: "SECRET", code_interne: "TRA-2026-000009", type_unite: "colis", statut: "dans_depot" },
  ];
  it("trouve par le code d'origine, par le code interne, et normalise les valeurs", async () => {
    const db = fakeDb({ stock_unites: unites }) as never;
    expect((await trouverUniteParCode(db, ORG, " 003456789012345678 "))?.id).toBe("x1");
    const u = await trouverUniteParCode(db, ORG, "TRA-2026-000001");
    expect(u).toMatchObject({ id: "x1", code: "003456789012345678", code_interne: "TRA-2026-000001", poids_kg: 2.5, fragile: true, urgent: false, nature: "colis" });
  });
  it("code inconnu, vide ou d'une autre organisation : null", async () => {
    const db = fakeDb({ stock_unites: unites }) as never;
    expect(await trouverUniteParCode(db, ORG, "INCONNU")).toBeNull();
    expect(await trouverUniteParCode(db, ORG, "   ")).toBeNull();
    expect(await trouverUniteParCode(db, ORG, "SECRET")).toBeNull();
    expect(await trouverUniteParCode(db, ORG, "TRA-2026-000009")).toBeNull();
  });
  it("ancien schéma (colonne code_interne absente) : la recherche par le code principal fonctionne, le code interne ne trouve rien", async () => {
    const reponses = [{ error: { code: "42703", message: "column stock_unites.code_interne does not exist" } }, { data: { id: "x2", code: "COLIS-2", statut: "livre", type_unite: "colis" } }];
    let n = 0;
    const chaine: any = { select: () => chaine, eq: () => chaine, maybeSingle: () => Promise.resolve({ data: reponses[Math.min(n++, 1)]!.data ?? null, error: reponses[Math.min(n - 1, 1)]!.error ?? null }) };
    const u = await trouverUniteParCode({ from: () => chaine } as never, ORG, "COLIS-2");
    expect(u).toMatchObject({ id: "x2", code_interne: null, nature: null, fragile: false });
  });
  it("completerUnite : valeurs par défaut pour les colonnes absentes", () => {
    expect(completerUnite({ id: "a", code: "C" })).toMatchObject({ code_interne: null, profil: null, nature: null, fragile: false, urgent: false, consigne: null, lot: null, dlc: null });
  });
  it("unités par identifiant : ordre demandé conservé, hors organisation ignoré", async () => {
    const db = fakeDb({ stock_unites: unites }) as never;
    expect((await unitesParIds(db, ORG, ["x2", "x1", "x3"])).map((u) => u.id)).toEqual(["x2", "x1"]);
  });
});

describe("impression des étiquettes (serveur)", () => {
  const tables = () => ({
    stock_parametres: [{ organization_id: ORG, profils: ["messagerie"], prefixe_code: "TMF", format_etiquette: null, profils_config: { version: 1, actifs: ["messagerie", "sante"], profils: {} } }],
    organizations: [{ id: ORG, name: "Transports Martin et Fils", logo_url: null }],
    stock_sites: [{ id: "s1", organization_id: ORG, nom: "Dépôt Nord", adresse: null, service_id: null, actif: true }],
    stock_emplacements: [],
    stock_articles: [],
    stock_unites: [
      { id: "11111111-1111-4111-8111-111111111111", organization_id: ORG, code: "003456789012345678", code_interne: "TMF-2026-000001", profil: "sante", type_unite: "colis", statut: "dans_depot", site_id: "s1", emplacement_id: null, nature: "prelevement", temperature: "frais", urgent: true, fragile: false },
      { id: "22222222-2222-4222-8222-222222222222", organization_id: ORG, code: "COLIS-2", code_interne: null, profil: "messagerie", type_unite: "colis", statut: "dans_depot", site_id: "s1", emplacement_id: null },
    ],
  });
  it("la demande est validée : 500 étiquettes au plus, formats connus, identifiants valides", () => {
    expect(schemaImpression.safeParse({ mode: "unites", ids: ["11111111-1111-4111-8111-111111111111"] }).success).toBe(true);
    expect(schemaImpression.safeParse({ mode: "unites", ids: [] }).success).toBe(false);
    expect(schemaImpression.safeParse({ mode: "unites", ids: ["pas-un-uuid"] }).success).toBe(false);
    expect(schemaImpression.safeParse({ mode: "unites", ids: ["11111111-1111-4111-8111-111111111111"], format: "a3" }).success).toBe(false);
    expect(schemaImpression.safeParse({ mode: "vierges", nombre: 500, cle: "cle-test-0001" }).success).toBe(true);
    expect(schemaImpression.safeParse({ mode: "vierges", nombre: 501, cle: "cle-test-0001" }).success).toBe(false);
    expect(schemaImpression.safeParse({ mode: "vierges", codes: Array.from({ length: 501 }, (_, i) => `TMF-2026-${String(i + 1).padStart(6, "0")}`) }).success).toBe(false);
  });
  it("étiquettes d'unités : PDF, une page par étiquette en thermique, journalisé sans contenu", async () => {
    const db = fakeDb(tables()) as never;
    const r = await produireEtiquettes(db, USER, { mode: "unites", ids: ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"], format: "thermique_100x150" });
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("application/pdf");
    expect(r.headers.get("X-Etiquettes")).toBe("2");
    expect(r.headers.get("X-Code-Premier")).toBe("TMF-2026-000001"); // le code interne s'il existe
    expect(r.headers.get("X-Code-Dernier")).toBe("COLIS-2");
    const pdf = Buffer.from(await r.arrayBuffer());
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect((pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length).toBe(2);
    expect(journal).toEqual([expect.objectContaining({ action: "stock_etiquettes_imprimees", details: { mode: "unites", nombre: 2, format: "thermique_100x150", par_page: 1 } })]);
  });
  it("unité inconnue ou hors périmètre : 404, rien n'est imprimé ni journalisé", async () => {
    const db = fakeDb(tables()) as never;
    const r = await produireEtiquettes(db, USER, { mode: "unites", ids: ["33333333-3333-4333-8333-333333333333"] });
    expect(r.status).toBe(404);
    expect(journal).toHaveLength(0);
  });
  it("format : celui demandé, sinon celui de l'organisation, sinon celui du profil", async () => {
    const lireFormat = async (t: ReturnType<typeof tables>, format?: string) => {
      const r = await produireEtiquettes(fakeDb(t) as never, USER, { mode: "unites", ids: ["22222222-2222-4222-8222-222222222222"], ...(format ? { format } : {}) } as never);
      return journal.at(-1)!.details!.format;
    };
    expect(await lireFormat(tables(), "a4_2x4")).toBe("a4_2x4");
    expect(await lireFormat(tables())).toBe("a4_3x7"); // profil messagerie
    const t = tables();
    (t.stock_parametres[0] as Record<string, unknown>).format_etiquette = "etiquette_62x29";
    expect(await lireFormat(t)).toBe("etiquette_62x29");
  });
  it("planche vierge : génère les codes (clé d'idempotence), imprime N étiquettes sur le bon nombre de pages", async () => {
    const codes = Array.from({ length: 24 }, (_, i) => `TMF-2026-${String(i + 1).padStart(6, "0")}`);
    const appels: { nom: string; params: Record<string, unknown> }[] = [];
    const db = Object.assign(fakeDb(tables()), { rpc: (nom: string, params: Record<string, unknown>) => (appels.push({ nom, params }), Promise.resolve({ data: { ok: true, doublon: false, codes, prefixe: "TMF", annee: 2026 }, error: null })) });
    const r = await produireEtiquettes(db as never, USER, { mode: "vierges", nombre: 24, cle: "cle-test-0001", format: "a4_2x4" });
    expect(r.status).toBe(200);
    expect(appels).toEqual([{ nom: "stock_generer_codes", params: { p_nombre: 24, p_cle: "cle-test-0001" } }]);
    expect(r.headers.get("X-Etiquettes")).toBe("24");
    const pdf = Buffer.from(await r.arrayBuffer());
    expect((pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length).toBe(3); // 24 étiquettes, 8 par page
    expect(journal.map((j) => j.action)).toEqual(["stock_codes_generes", "stock_etiquettes_imprimees"]);
    expect(journal[0]!.details).toMatchObject({ nombre: 24, origine: "planche" });
  });
  it("planche vierge : la limite de 500 est portée par la base (erreur traduite), rien n'est imprimé", async () => {
    const db = Object.assign(fakeDb(tables()), { rpc: () => Promise.resolve({ data: null, error: { message: "stock_limite_depassee" } }) });
    const r = await produireEtiquettes(db as never, USER, { mode: "vierges", nombre: 500, cle: "cle-test-0002" });
    expect(r.status).toBe(400);
    expect(journal).toHaveLength(0);
  });
  it("réimpression de codes déjà générés : seuls des codes internes sont acceptés, aucun appel de génération", async () => {
    const db = fakeDb(tables()) as never;
    const ok = await produireEtiquettes(db, USER, { mode: "vierges", codes: ["TMF-2026-000001", "TMF-2026-000002"], format: "a4_3x7" });
    expect(ok.status).toBe(200);
    const refus = await produireEtiquettes(db, USER, { mode: "vierges", codes: ["NIMPORTE-QUOI"] });
    expect(refus.status).toBe(400);
  });
  it("planche entamée : les emplacements déjà utilisés ajoutent une page quand il le faut", async () => {
    const db = fakeDb(tables()) as never;
    const codes = Array.from({ length: 21 }, (_, i) => `TMF-2026-${String(i + 1).padStart(6, "0")}`);
    const sans = await produireEtiquettes(db, USER, { mode: "vierges", codes, format: "a4_3x7", debut: 0 });
    const avec = await produireEtiquettes(db, USER, { mode: "vierges", codes, format: "a4_3x7", debut: 5 });
    const pages = async (r: Response) => (Buffer.from(await r.arrayBuffer()).toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
    expect(await pages(sans)).toBe(1);
    expect(await pages(avec)).toBe(2);
  });
  it("un code avec des accents ne casse pas les en-têtes de réponse (encodés)", async () => {
    const db = fakeDb(tables()) as never;
    const r = await produireEtiquettes(db, USER, { mode: "unites", ids: ["22222222-2222-4222-8222-222222222222"] });
    expect(r.headers.get("X-Code-Premier")).toBe("COLIS-2");
    const t = tables();
    t.stock_unites[1]!.code = "Étiquette n°1";
    const r2 = await produireEtiquettes(fakeDb(t) as never, USER, { mode: "unites", ids: ["22222222-2222-4222-8222-222222222222"] });
    expect(r2.status).toBe(200);
    expect(decodeURIComponent(r2.headers.get("X-Code-Premier")!)).toBe("Étiquette n°1");
    expect(r2.headers.get("X-Code-Premier")).toMatch(/^[\x20-\x7e]+$/);
  });
  it("tables du stock absentes : 503 clair", async () => {
    const r = await produireEtiquettes(fakeDb({}) as never, USER, { mode: "vierges", codes: ["TMF-2026-000001"] });
    expect(r.status).toBe(503);
  });
});
