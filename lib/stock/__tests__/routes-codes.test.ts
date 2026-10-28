import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/organization/modules", () => ({ isModuleEnabled: async () => true }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: () => null }));
const journal: { action: string; details?: Record<string, unknown>; targetId?: string | null }[] = [];
vi.mock("@/lib/audit/journal", () => ({ journaliser: async (p: { action: string }) => void journal.push(p as never), ACTIONS_AUDIT: {} }));

type Contexte = { ok: true; supabase: unknown; appUser: { id: string; organization_id: string; role: string } };
let contexte: Contexte;
const rolesVus: unknown[] = [];
vi.mock("@/lib/acces/garde-api", () => ({
  garderApi: async (opts: { roles: unknown }) => {
    rolesVus.push(opts.roles);
    return contexte;
  },
}));

import { GET as getUnites } from "@/app/api/stock/unites/route";
import { PATCH as patchUnite } from "@/app/api/stock/unites/[id]/route";
import { POST as postCodes } from "@/app/api/stock/codes/route";
import { GET as getParametres, PUT as putParametres } from "@/app/api/stock/parametres/route";
import { POST as postMouvement } from "@/app/api/stock/mouvements/route";
import { GET as getEtiquettes } from "@/app/api/stock/etiquettes/route";
import { fakeDb } from "../../planning/__tests__/_fake-db";

const ORG = "o1";
const SITE = "11111111-1111-4111-8111-111111111111";
const UNITE = "22222222-2222-4222-8222-222222222222";
const appels: { nom: string; params: Record<string, unknown> }[] = [];
const requete = (corps: unknown, url = "http://x/api") => new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });

function installer(tables: Record<string, Record<string, unknown>[]>, rpcReponse: (nom: string, params: Record<string, unknown>) => { data?: unknown; error?: { code?: string; message: string } | null } = () => ({ data: {} }), role = "direction") {
  const db = fakeDb(tables as never);
  const supabase = Object.assign(db, {
    rpc: (nom: string, params: Record<string, unknown>) => {
      appels.push({ nom, params });
      const r = rpcReponse(nom, params);
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
    },
  });
  contexte = { ok: true, supabase, appUser: { id: "u1", organization_id: ORG, role } };
  return db;
}
const parametresInstalles = (extra: Record<string, unknown> = {}) => ({ organization_id: ORG, profils: ["messagerie"], prefixe_code: null, format_etiquette: null, profils_config: { version: 1, actifs: ["messagerie"], profils: {} }, ...extra });

beforeEach(() => {
  journal.length = 0;
  appels.length = 0;
  rolesVus.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("POST /api/stock/codes", () => {
  it("génère N codes et journalise la génération en masse", async () => {
    installer({}, () => ({ data: { ok: true, doublon: false, codes: ["TMF-2026-000001", "TMF-2026-000002"], prefixe: "TMF", annee: 2026 } }), "chauffeur");
    const r = await postCodes(requete({ nombre: 2, cle: "cle-test-0001" }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, doublon: false, codes: ["TMF-2026-000001", "TMF-2026-000002"], prefixe: "TMF", annee: 2026 });
    expect(appels).toEqual([{ nom: "stock_generer_codes", params: { p_nombre: 2, p_cle: "cle-test-0001" } }]);
    expect(journal.map((j) => j.action)).toEqual(["stock_codes_generes"]);
  });
  it("refuse 0, 501, une décimale, une clé absente ou trop courte (message clair, aucun appel à la base)", async () => {
    installer({});
    for (const corps of [{ nombre: 0, cle: "cle-test-0001" }, { nombre: 501, cle: "cle-test-0001" }, { nombre: 1.5, cle: "cle-test-0001" }, { nombre: 5 }, { nombre: 5, cle: "abc" }, null]) {
      const r = await postCodes(requete(corps));
      expect(r.status, JSON.stringify(corps)).toBe(400);
    }
    const r = await postCodes(requete({ nombre: 501, cle: "cle-test-0001" }));
    expect((await r.json()).error).toBe("Indiquez un nombre de codes entre 1 et 500.");
    expect(appels).toHaveLength(0);
  });
  it("la base refuse (rôle, module) : erreur traduite avec son statut", async () => {
    installer({}, () => ({ error: { message: "stock_role_refuse" } }));
    const r = await postCodes(requete({ nombre: 1, cle: "cle-test-0001" }));
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe("stock_role_refuse");
  });
});

describe("PUT /api/stock/parametres", () => {
  it("préfixe : passe par la fonction SQL et journalise avant / après", async () => {
    installer({ stock_parametres: [parametresInstalles()] }, (nom) => (nom === "stock_definir_prefixe" ? { data: { ok: true, prefixe: "TMF", avant: "TRA", codes_generes: true } } : {}));
    const r = await putParametres(requete({ prefixe_code: "tmf" }));
    expect(r.status).toBe(200);
    expect(appels).toEqual([{ nom: "stock_definir_prefixe", params: { p_prefixe: "tmf" } }]);
    expect(journal).toEqual([expect.objectContaining({ action: "stock_prefixe_modifie", details: { avant: "TRA", apres: "TMF", codes_deja_generes: true } })]);
  });
  it("préfixe invalide refusé par la base : message clair", async () => {
    installer({ stock_parametres: [parametresInstalles()] }, () => ({ error: { message: "stock_prefixe_invalide" } }));
    const r = await putParametres(requete({ prefixe_code: "X" }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/2 à 6 caractères/);
    expect(journal).toHaveLength(0);
  });
  it("profils : colonne historique en familles, profils réels dans profils_config, journal avant / après", async () => {
    const db = installer({ stock_parametres: [parametresInstalles()] });
    const r = await putParametres(requete({ profils: ["sante", "pharmacie", "messagerie"] }));
    expect(r.status).toBe(200);
    const ligne = db.ligne("stock_parametres")[0]!;
    expect(ligne.profils).toEqual(["messagerie", "vrac"]);
    expect(ligne.profils_config).toEqual({ version: 1, actifs: ["messagerie", "sante", "pharmacie"], profils: {} });
    expect(journal).toEqual([expect.objectContaining({ action: "stock_profils_modifies", details: { avant: ["messagerie"], apres: ["messagerie", "sante", "pharmacie"] } })]);
    expect((await r.json()).profils).toEqual(["messagerie", "sante", "pharmacie"]);
  });
  it("personnalisation d'un profil : enregistrée, les profils désactivés sont retirés de la configuration", async () => {
    const db = installer({ stock_parametres: [parametresInstalles({ profils_config: { version: 1, actifs: ["messagerie", "sante"], profils: { sante: { fefo: true } } } , profils: ["messagerie"] })] });
    const r = await putParametres(requete({ config: { messagerie: { champs: { poids: "requis" } } } }));
    expect(r.status).toBe(200);
    expect(db.ligne("stock_parametres")[0]!.profils_config).toEqual({ version: 1, actifs: ["messagerie", "sante"], profils: { sante: { fefo: true }, messagerie: { champs: { poids: "requis" } } } });
    await putParametres(requete({ profils: ["messagerie"] }));
    expect(db.ligne("stock_parametres")[0]!.profils_config.profils).toEqual({ messagerie: { champs: { poids: "requis" } } });
    expect(journal.map((j) => j.action)).toEqual(["stock_profil_config_modifie", "stock_profils_modifies"]);
  });
  it("configuration invalide : refusée avec un message précis (champ oui / non obligatoire, délai hors limites, format inconnu)", async () => {
    installer({ stock_parametres: [parametresInstalles()] });
    const r1 = await putParametres(requete({ config: { messagerie: { champs: { fragile: "requis" } } } }));
    expect(r1.status).toBe(400);
    expect((await r1.json()).error).toMatch(/ne peut pas être obligatoire/);
    for (const corps of [{ config: { messagerie: { alertes: { dlc_jours: 0 } } } }, { config: { labo: {} } }, { profils: ["labo"] }, { format_etiquette: "a3" }, {}, { prefixe_code: "" }, { inconnu: 1 }]) {
      expect((await putParametres(requete(corps))).status, JSON.stringify(corps)).toBe(400);
    }
    expect(journal).toHaveLength(0);
  });
  it("format d'étiquette mémorisé par organisation et journalisé", async () => {
    const db = installer({ stock_parametres: [parametresInstalles()] });
    const r = await putParametres(requete({ format_etiquette: "thermique_100x150" }));
    expect(r.status).toBe(200);
    expect(db.ligne("stock_parametres")[0]!.format_etiquette).toBe("thermique_100x150");
    expect(journal).toEqual([expect.objectContaining({ action: "stock_format_etiquette_modifie", details: { avant: null, apres: "thermique_100x150" } })]);
  });
  it("migrations des codes pas appliquées : seuls les profils historiques s'enregistrent, le reste répond 503", async () => {
    // Le premier select (colonnes complètes) échoue : colonne absente ; le second (profils) répond.
    const db = installer({ stock_parametres: [{ organization_id: ORG, profils: [] }] });
    const origine = db.from.bind(db);
    db.from = ((nom: string) => {
      const q: any = origine(nom);
      if (nom !== "stock_parametres") return q;
      return new Proxy(q, {
        get(cible, prop) {
          if (prop === "select") return (colonnes: string) => (String(colonnes).includes("prefixe_code") ? { eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { code: "42703", message: "column stock_parametres.prefixe_code does not exist" } }) }) } : cible.select(colonnes));
          return typeof cible[prop] === "function" ? cible[prop].bind(cible) : cible[prop];
        },
      });
    }) as never;
    expect((await putParametres(requete({ prefixe_code: "TMF" }))).status).toBe(503);
    expect((await putParametres(requete({ profils: ["sante"] }))).status).toBe(503);
    expect((await putParametres(requete({ profils: ["messagerie", "vrac"] }))).status).toBe(200);
    expect(db.ligne("stock_parametres")[0]!.profils).toEqual(["messagerie", "vrac"]);
    expect(db.ligne("stock_parametres")[0]).not.toHaveProperty("profils_config");
  });
  it("GET : profils, configuration, préfixe et préfixe proposé d'après le nom de l'entreprise", async () => {
    installer({ stock_parametres: [parametresInstalles({ prefixe_code: "TRA" })], organizations: [{ id: ORG, name: "Transports Martin et Fils" }] });
    const r = await getParametres();
    const j = await r.json();
    expect(j).toMatchObject({ profils: ["messagerie"], prefixe: "TRA", prefixeParDefaut: "TMF", codesInstalles: true });
  });
});

describe("PATCH /api/stock/unites/[id]", () => {
  const ctx = { params: Promise.resolve({ id: UNITE }) };
  it("modifie les attributs par la fonction SQL et journalise les clés (jamais les valeurs)", async () => {
    installer({}, () => ({ data: { ok: true, unite_id: UNITE } }), "manager");
    const r = await patchUnite(requete({ attributs: { consigne: "Au frais", fragile: true, temperature: null } }), ctx);
    expect(r.status).toBe(200);
    expect(appels[0]).toEqual({ nom: "stock_modifier_unite", params: { p_unite: UNITE, p_attributs: { consigne: "Au frais", fragile: true, temperature: null }, p_code_interne: null } });
    expect(journal).toEqual([expect.objectContaining({ action: "stock_unite_modifiee", targetId: UNITE, details: { champs: ["temperature", "fragile", "consigne"], code_interne: false } })]);
    expect(JSON.stringify(journal)).not.toContain("Au frais");
  });
  it("rattache un code interne ; un code mal formé est refusé avant la base", async () => {
    installer({}, () => ({ data: { ok: true, unite_id: UNITE } }));
    expect((await patchUnite(requete({ code_interne: "TMF-2026-000007" }), ctx)).status).toBe(200);
    expect(appels[0]!.params).toMatchObject({ p_code_interne: "TMF-2026-000007", p_attributs: null });
    appels.length = 0;
    expect((await patchUnite(requete({ code_interne: "n'importe quoi" }), ctx)).status).toBe(400);
    expect(appels).toHaveLength(0);
  });
  it("refus de la base : code ambigu 409, champ obligatoire 400 nommé", async () => {
    installer({}, () => ({ error: { message: "stock_code_ambigu" } }));
    expect((await patchUnite(requete({ code_interne: "TMF-2026-000007" }), ctx)).status).toBe(409);
    installer({}, () => ({ error: { message: "stock_champ_requis_temperature" } }));
    const r = await patchUnite(requete({ attributs: { temperature: null } }), ctx);
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/Température cible/);
  });
  it("identifiant invalide, corps vide, attribut inconnu (donnée nominative) : 400", async () => {
    installer({});
    expect((await patchUnite(requete({ attributs: { consigne: "x" } }), { params: Promise.resolve({ id: "pas-un-uuid" }) })).status).toBe(400);
    expect((await patchUnite(requete({}), ctx)).status).toBe(400);
    expect((await patchUnite(requete({ attributs: { nom_patient: "Dupont" } }), ctx)).status).toBe(400);
    expect((await patchUnite(requete({ attributs: { consigne: "x".repeat(121) } }), ctx)).status).toBe(400);
    expect(appels).toHaveLength(0);
  });
});

describe("GET /api/stock/unites : le scan résout les deux codes", () => {
  const unites = [{ id: UNITE, organization_id: ORG, code: "EXT-42", code_interne: "TMF-2026-000001", type_unite: "colis", statut: "dans_depot", site_id: SITE, nature: "prelevement", urgent: true }];
  it("par le code d'origine et par le code interne : la même unité", async () => {
    installer({ stock_unites: unites, stock_parametres: [parametresInstalles()] });
    const a = await (await getUnites(new Request("http://x/api/stock/unites?code=EXT-42"))).json();
    const b = await (await getUnites(new Request("http://x/api/stock/unites?code=TMF-2026-000001"))).json();
    expect(a.unite.id).toBe(UNITE);
    expect(b.unite.id).toBe(UNITE);
    expect(b.unite).toMatchObject({ code: "EXT-42", code_interne: "TMF-2026-000001", nature: "prelevement", urgent: true });
  });
  it("code inconnu : unite null", async () => {
    installer({ stock_unites: unites, stock_parametres: [parametresInstalles()] });
    expect((await (await getUnites(new Request("http://x/api/stock/unites?code=NOPE"))).json()).unite).toBeNull();
  });
  it("recherche libre et filtres : la liste renvoie les attributs", async () => {
    installer({ stock_unites: unites, stock_parametres: [parametresInstalles()] });
    const r = await (await getUnites(new Request("http://x/api/stock/unites?urgent=1&nature=prelevement"))).json();
    expect(r.total).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(r.unites)).toBe(true);
  });
});

describe("POST /api/stock/mouvements : profil, champs obligatoires, code interne", () => {
  const corps = (extra: Record<string, unknown>) => ({ cle: "cle-test-0001", type: "entree", site_id: SITE, type_unite: "colis", ...extra });
  it("santé sans température : refus clair avant tout appel à la base", async () => {
    installer({ stock_parametres: [parametresInstalles({ profils_config: { version: 1, actifs: ["sante"], profils: {} } })], stock_unites: [] });
    const r = await postMouvement(requete(corps({ code: "ECH-1" })));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/Champ obligatoire pour le profil Santé.*Température cible/);
    expect(appels).toHaveLength(0);
  });
  it("santé avec température : appel de la fonction v2 avec le profil et les attributs ; code et code interne renvoyés", async () => {
    installer({ stock_parametres: [parametresInstalles({ profils_config: { version: 1, actifs: ["sante"], profils: {} } })], stock_unites: [] }, () => ({ data: { ok: true, doublon: false, mouvement_id: "m1", unite_id: UNITE, statut: "dans_depot", code: "ECH-1", code_interne: "TMF-2026-000001" } }), "chauffeur");
    const r = await postMouvement(requete(corps({ code: "ECH-1", code_interne: "TMF-2026-000001", attributs: { temperature: "frais", urgent: true } })));
    expect(r.status).toBe(200);
    expect(appels[0]!.nom).toBe("stock_enregistrer_mouvement_v2");
    expect(appels[0]!.params).toMatchObject({ p_unite_code: "ECH-1", p_profil: "sante", p_code_interne: "TMF-2026-000001", p_attributs: { temperature: "frais", urgent: true } });
    expect(await r.json()).toMatchObject({ ok: true, unite_id: UNITE, code: "ECH-1", code_interne: "TMF-2026-000001" });
  });
  it("une unité déjà connue (retrouvée par son code interne) garde ses valeurs : pas de ressaisie de la température", async () => {
    installer(
      { stock_parametres: [parametresInstalles({ profils_config: { version: 1, actifs: ["sante"], profils: {} } })], stock_unites: [{ id: UNITE, organization_id: ORG, code: "ECH-1", code_interne: "TMF-2026-000001", temperature: "frais", statut: "livre", type_unite: "colis" }] },
      () => ({ data: { ok: true, doublon: false, mouvement_id: "m1", unite_id: UNITE, statut: "dans_depot" } }),
    );
    const r = await postMouvement(requete(corps({ code: "TMF-2026-000001" })));
    expect(r.status).toBe(200);
  });
  it("code ambigu refusé par la base : 409 avec message clair", async () => {
    installer({ stock_parametres: [parametresInstalles()], stock_unites: [] }, () => ({ error: { message: "stock_code_ambigu" } }));
    const r = await postMouvement(requete(corps({ code: "EXT-1", code_interne: "TMF-2026-000001" })));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/autre unité/);
  });
});

describe("GET /api/stock/etiquettes : demande invalide", () => {
  it("sans identifiant ou avec un identifiant invalide : 400", async () => {
    installer({ stock_parametres: [parametresInstalles()] });
    expect((await getEtiquettes(new Request("http://x/api/stock/etiquettes"))).status).toBe(400);
    expect((await getEtiquettes(new Request("http://x/api/stock/etiquettes?unites=abc"))).status).toBe(400);
    expect((await getEtiquettes(new Request(`http://x/api/stock/etiquettes?unites=${UNITE}&format=a3`))).status).toBe(400);
  });
});
