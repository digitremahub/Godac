import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/organization/modules", () => ({ isModuleEnabled: async () => true }));

import { appelerMouvement, lireParametresStock } from "@/lib/stock/serveur";
import type { ParametresRpcMouvement } from "@/lib/stock/mouvements";

const params: ParametresRpcMouvement = {
  p_cle: "cle-test-0001", p_type: "entree", p_site: "s1", p_unite_code: "C1", p_type_unite: "colis", p_article: null, p_quantite: 1, p_src: null, p_dest: null, p_lot: null, p_dlc: null,
  p_sens: null, p_statut_apres: null, p_motif: null, p_run: null, p_stop: null, p_poids: null, p_volume: null, p_sscc: null, p_source: "app",
};
const rpc = (reponse: { data?: unknown; error?: { code?: string; message: string } | null }) => ({ rpc: () => Promise.resolve({ data: reponse.data ?? null, error: reponse.error ?? null }) }) as never;

describe("appel de la fonction de mouvement", () => {
  it("succès : identifiants du mouvement et de l'unité", async () => {
    const r = await appelerMouvement(rpc({ data: { ok: true, doublon: false, mouvement_id: "m1", unite_id: "u1", statut: "dans_depot" } }), params);
    expect(r).toEqual({ ok: true, doublon: false, mouvementId: "m1", uniteId: "u1", statut: "dans_depot", quantiteApres: null });
  });
  it("rejeu d'une même clé : succès marqué doublon", async () => {
    const r = await appelerMouvement(rpc({ data: { ok: true, doublon: true, mouvement_id: "m1" } }), params);
    expect(r).toMatchObject({ ok: true, doublon: true, mouvementId: "m1" });
  });
  it("deux requêtes simultanées de même clé : l'unicité de la base est traitée comme un doublon", async () => {
    const r = await appelerMouvement(rpc({ error: { code: "23505", message: 'duplicate key value violates unique constraint "stock_mouvements_organization_id_cle_idempotence_key"' } }), params);
    expect(r).toMatchObject({ ok: true, doublon: true });
  });
  it("erreur métier traduite", async () => {
    const r = await appelerMouvement(rpc({ error: { message: "stock_insuffisant" } }), params);
    expect(r).toMatchObject({ ok: false, code: "stock_insuffisant", status: 409 });
  });
  it("quantité d'article renvoyée en nombre", async () => {
    const r = await appelerMouvement(rpc({ data: { ok: true, doublon: false, mouvement_id: "m2", quantite_apres: "7.000" } }), params);
    expect(r).toMatchObject({ ok: true, quantiteApres: 7 });
  });
});

describe("profils activés", () => {
  const lecture = (reponse: { data?: unknown; error?: { code?: string; message: string } | null }) =>
    ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: reponse.data ?? null, error: reponse.error ?? null }) }) }) }) }) as never;
  it("lit et normalise les profils", async () => {
    expect(await lireParametresStock(lecture({ data: { profils: ["vrac", "x", "messagerie"] } }), "o1")).toEqual({ profils: ["messagerie", "vrac"], schemaAbsent: false });
  });
  it("aucune ligne : aucun profil", async () => {
    expect(await lireParametresStock(lecture({ data: null }), "o1")).toEqual({ profils: [], schemaAbsent: false });
  });
  it("table absente : aucun profil, schéma signalé absent", async () => {
    expect(await lireParametresStock(lecture({ error: { code: "42P01", message: "relation does not exist" } }), "o1")).toEqual({ profils: [], schemaAbsent: true });
  });
});
