import { describe, expect, it } from "vitest";
import { VALIDITE_CHALLENGE_S, cleUsageUnique, lireChallengeSigne, signerChallenge } from "@/lib/auth/challenge-signe";

const SECRET = "secret-de-test";
const T0 = 1_800_000_000_000;

describe("cookie de challenge signé", () => {
  it("relit le challenge signé", () => {
    const cookie = signerChallenge("abc_DEF-123", SECRET, T0);
    expect(lireChallengeSigne(cookie, SECRET, T0 + 1000)).toBe("abc_DEF-123");
  });
  it("expire après 180 s", () => {
    expect(VALIDITE_CHALLENGE_S).toBe(180);
    const cookie = signerChallenge("abc", SECRET, T0);
    expect(lireChallengeSigne(cookie, SECRET, T0 + 179_000)).toBe("abc");
    expect(lireChallengeSigne(cookie, SECRET, T0 + 181_000)).toBeNull();
  });
  it("refuse un challenge modifié, une expiration rallongée, un autre secret ou une valeur non signée", () => {
    const cookie = signerChallenge("abc", SECRET, T0);
    const [, exp, sig] = cookie.split(".") as [string, string, string];
    expect(lireChallengeSigne(`xyz.${exp}.${sig}`, SECRET, T0)).toBeNull();
    expect(lireChallengeSigne(`abc.${Number(exp) + 3600}.${sig}`, SECRET, T0)).toBeNull();
    expect(lireChallengeSigne(cookie, "autre-secret", T0)).toBeNull();
    expect(lireChallengeSigne("abc", SECRET, T0)).toBeNull();
    expect(lireChallengeSigne("", SECRET, T0)).toBeNull();
    expect(lireChallengeSigne(undefined, SECRET, T0)).toBeNull();
    expect(lireChallengeSigne(`abc.${exp}.court`, SECRET, T0)).toBeNull();
  });
  it("la clé d'usage unique ne contient pas le challenge", () => {
    const cle = cleUsageUnique("challenge-secret");
    expect(cle).not.toContain("challenge-secret");
    expect(cleUsageUnique("challenge-secret")).toBe(cle);
    expect(cleUsageUnique("autre")).not.toBe(cle);
  });
});
