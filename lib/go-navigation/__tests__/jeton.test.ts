import { describe, expect, it } from "vitest";
import { genererJetonInvitation, hacherIpInscription, hacherJetonInvitation, ressembleJetonInvitation } from "@/lib/go-navigation/jeton";
import { hashProviderToken } from "@/lib/rental/token";

describe("jeton d'invitation GO Navigation", () => {
  it("43 caractères base64url, différent à chaque fois", () => {
    const a = genererJetonInvitation();
    const b = genererJetonInvitation();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(ressembleJetonInvitation(a)).toBe(true);
  });

  it("rejette les formes invalides avant la base", () => {
    expect(ressembleJetonInvitation("")).toBe(false);
    expect(ressembleJetonInvitation("abc")).toBe(false);
    expect(ressembleJetonInvitation(`${"a".repeat(42)}!`)).toBe(false);
    expect(ressembleJetonInvitation(null)).toBe(false);
  });

  it("hash stable, jamais le jeton en clair, distinct du lien prestataire", () => {
    const j = genererJetonInvitation();
    const h = hacherJetonInvitation(j);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(hacherJetonInvitation(j));
    expect(h).not.toContain(j);
    expect(h).not.toBe(hashProviderToken(j));
  });

  it("IP hachée et tronquée", () => {
    expect(hacherIpInscription("1.2.3.4")).toMatch(/^[0-9a-f]{32}$/);
    expect(hacherIpInscription("1.2.3.4")).not.toBe(hacherIpInscription("1.2.3.5"));
  });
});
