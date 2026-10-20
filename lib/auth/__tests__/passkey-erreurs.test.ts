import { describe, expect, it } from "vitest";
import { choisirRp, ErreurServeurPasskey, expliquerErreurPasskey, texteErreurServeur, userIdDepuisHandle } from "../passkey-erreurs";

const erreur = (name: string, code?: string) => Object.assign(new Error("x"), { name, ...(code ? { code } : {}) });

describe("expliquerErreurPasskey", () => {
  it("donne le code du navigateur", () => {
    expect(expliquerErreurPasskey(erreur("NotAllowedError")).code).toBe("NotAllowedError");
    expect(expliquerErreurPasskey(erreur("SecurityError", "ERROR_INVALID_RP_ID")).code).toBe("SecurityError/ERROR_INVALID_RP_ID");
    expect(expliquerErreurPasskey(erreur("InvalidStateError")).code).toBe("InvalidStateError");
    expect(expliquerErreurPasskey(erreur("NonPrisEnCharge")).message).toMatch(/Chrome/);
  });
  it("donne le code et le texte du serveur", () => {
    const r = expliquerErreurPasskey(new ErreurServeurPasskey("Vérification de la clé refusée : origine", "verification_echouee", 400));
    expect(r).toEqual({ code: "verification_echouee (400)", message: "Vérification de la clé refusée : origine" });
  });
  it("secours personnalisé", () => {
    expect(expliquerErreurPasskey(erreur("NotAllowedError"), { secours: "votre PIN" }).message).toMatch(/votre PIN/);
  });
});

describe("texteErreurServeur", () => {
  it("chaîne d'erreur, sinon défaut et code http", () => {
    expect(texteErreurServeur({ error: "Oups", code: "cle_inconnue" }, 400, "d")).toEqual({ message: "Oups", code: "cle_inconnue" });
    expect(texteErreurServeur({ error: { fieldErrors: {} } }, 400, "défaut")).toEqual({ message: "défaut", code: "http_400" });
  });
});

describe("userIdDepuisHandle", () => {
  it("décode l'identifiant enregistré (UTF-8 de users.id, base64url)", () => {
    const id = "3f2a1c4e-0b6d-4e8f-9a1b-2c3d4e5f6a7b";
    expect(userIdDepuisHandle(Buffer.from(id, "utf8").toString("base64url"))).toBe(id);
    expect(userIdDepuisHandle(null)).toBeNull();
    expect(userIdDepuisHandle("AAAA")).toBeNull();
  });
});

describe("choisirRp", () => {
  it("domaine de l'application par défaut", () => {
    const r = choisirRp({ urlApp: "https://godac-v2.vercel.app", origineRequete: "https://evil.example" });
    expect(r.rpID).toBe("godac-v2.vercel.app");
    expect(r.originesAdmises).toEqual(["https://godac-v2.vercel.app"]);
  });
  it("origine supplémentaire autorisée", () => {
    const r = choisirRp({ urlApp: "https://godac-v2.vercel.app", extra: "https://godac.app, mauvais", origineRequete: "https://godac.app" });
    expect(r.rpID).toBe("godac.app");
    expect(r.rpIdsAdmis).toEqual(["godac-v2.vercel.app", "godac.app"]);
  });
});
