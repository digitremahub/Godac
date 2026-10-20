import { afterEach, describe, expect, it, vi } from "vitest";
import { actionRefus, fetchGodac, lireRefus, titreRefus } from "@/lib/http/fetch-godac";

afterEach(() => vi.unstubAllGlobals());

describe("fetchGodac : lecture des refus homogènes", () => {
  it("lit le code, le module et les rôles du corps de refus", () => {
    const r = lireRefus(403, { error: "Le module Export TICPE n'est pas activé.", code: "MODULE_INACTIF", module: "ticpe_export" });
    expect(r).toMatchObject({ code: "MODULE_INACTIF", module: "ticpe_export", statut: 403 });
    expect(titreRefus(r)).toBe("Module non activé");
    expect(actionRefus(r, true)).toEqual({ href: "/admin/abonnement?vue=modules#module-ticpe_export", libelle: "Activer ce module" });
    expect(actionRefus(r, false)).toBeNull();
  });

  it("limite de formule et quota : action réservée à la direction", () => {
    const l = lireRefus(402, { error: "Votre formule Starter inclut 20 véhicules", code: "LIMITE_FORMULE", utilise: 22, inclus: 20 });
    expect(l).toMatchObject({ code: "LIMITE_FORMULE", utilise: 22, inclus: 20 });
    expect(actionRefus(l, true)?.libelle).toBe("Changer de formule");
    expect(lireRefus(429, { error: "Quota atteint" }).code).toBe("QUOTA_ATTEINT");
  });

  it("routes non migrées : code déduit du statut, message en objet ou absent", () => {
    expect(lireRefus(401, {}).code).toBe("NON_CONNECTE");
    expect(lireRefus(400, { error: { message: "Immatriculation invalide" } })).toMatchObject({ code: "ERREUR", message: "Immatriculation invalide" });
    expect(lireRefus(500, null).message).toMatch(/serveur/);
  });

  it("réponse OK, refus et panne réseau", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ vehicle: { id: "v1" } }), { status: 201 })));
    expect(await fetchGodac("/api/vehicles")).toEqual({ ok: true, data: { vehicle: { id: "v1" } }, statut: 201 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: "Réservé", code: "ROLE_REFUSE", rolesAutorises: ["direction"] }), { status: 403 })));
    const r = await fetchGodac("/api/x");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refus).toMatchObject({ code: "ROLE_REFUSE", rolesAutorises: ["direction"] });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new TypeError("offline")));
    const p = await fetchGodac("/api/x");
    expect(!p.ok && p.refus.code).toBe("ERREUR");
  });
});
