import { describe, expect, it } from "vitest";
import {
  canManagerAct,
  canProviderAct,
  isRentedOwnership,
  isTerminal,
  nextStatusAfterManager,
  nextStatusAfterProvider,
} from "@/lib/rental/workflow";
import { generateProviderToken, hashProviderToken, isTokenUsable, looksLikeProviderToken, tokenExpiry } from "@/lib/rental/token";
import { daysUntil, endDateAlertDue, evaluateKmAllowance } from "@/lib/rental/contract";
import { invoiceStoragePath, validateInvoiceFile } from "@/lib/rental/invoice";
import { escapeHtml, renderProviderRequestEmail } from "@/lib/rental/email";

describe("workflow des demandes au loueur", () => {
  it("valide puis transmet", () => {
    expect(nextStatusAfterManager("a_valider", "valider")).toBe("validee");
    expect(nextStatusAfterManager("validee", "transmettre", true)).toBe("transmise");
    expect(nextStatusAfterManager("validee", "transmettre", false)).toBe("validee");
    expect(nextStatusAfterManager("planifiee", "transmettre")).toBe("planifiee");
  });

  it("interdit de transmettre sans validation", () => {
    expect(canManagerAct("a_valider", "transmettre")).toBe(false);
    expect(nextStatusAfterManager("a_valider", "transmettre")).toBeNull();
  });

  it("refus possible seulement avant transmission", () => {
    expect(nextStatusAfterManager("a_valider", "refuser")).toBe("refusee");
    expect(nextStatusAfterManager("validee", "refuser")).toBe("refusee");
    expect(nextStatusAfterManager("transmise", "refuser")).toBeNull();
  });

  it("le prestataire n'agit que sur une demande transmise", () => {
    expect(canProviderAct("a_valider", "accepter")).toBe(false);
    expect(canProviderAct("validee", "commenter")).toBe(false);
    expect(canProviderAct("terminee", "terminer")).toBe(false);
    expect(canProviderAct("refusee", "proposer_creneau")).toBe(false);
    expect(nextStatusAfterProvider("transmise", "accepter")).toBe("transmise");
    expect(nextStatusAfterProvider("transmise", "accepter", { hasSlot: true })).toBe("planifiee");
    expect(nextStatusAfterProvider("transmise", "proposer_creneau")).toBe("planifiee");
    expect(nextStatusAfterProvider("planifiee", "commenter")).toBe("planifiee");
    expect(nextStatusAfterProvider("planifiee", "terminer")).toBe("terminee");
  });

  it("statuts terminaux et détention", () => {
    expect(isTerminal("terminee")).toBe(true);
    expect(isTerminal("refusee")).toBe(true);
    expect(isTerminal("transmise")).toBe(false);
    expect(isRentedOwnership("propre")).toBe(false);
    expect(isRentedOwnership("location_longue_duree")).toBe(true);
    expect(isRentedOwnership(null)).toBe(false);
  });
});

describe("jeton prestataire", () => {
  it("32 octets en base64url, haché de façon stable", () => {
    const t = generateProviderToken();
    expect(t).toHaveLength(43);
    expect(looksLikeProviderToken(t)).toBe(true);
    expect(generateProviderToken()).not.toBe(t);
    expect(hashProviderToken(t)).toBe(hashProviderToken(t));
    expect(hashProviderToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashProviderToken(t)).not.toContain(t);
  });

  it("rejette les formes invalides", () => {
    expect(looksLikeProviderToken("abc")).toBe(false);
    expect(looksLikeProviderToken("x".repeat(42) + "/")).toBe(false);
    expect(looksLikeProviderToken(null)).toBe(false);
  });

  it("expire après 30 jours", () => {
    const now = new Date("2026-10-13T10:00:00Z");
    const exp = tokenExpiry(now);
    expect(exp.toISOString()).toBe("2026-11-12T10:00:00.000Z");
    expect(isTokenUsable(exp, new Date("2026-11-12T09:59:00Z"))).toBe(true);
    expect(isTokenUsable(exp, new Date("2026-11-12T10:00:01Z"))).toBe(false);
    expect(isTokenUsable(null, now)).toBe(false);
    expect(isTokenUsable("n'importe quoi", now)).toBe(false);
  });
});

describe("contrat de location", () => {
  it("échéance à 30 jours", () => {
    expect(daysUntil("2026-11-12", "2026-10-13")).toBe(30);
    expect(endDateAlertDue("2026-11-12", "2026-10-13")).toBe(true);
    expect(endDateAlertDue("2026-11-13", "2026-10-13")).toBe(false);
    expect(endDateAlertDue("2026-10-12", "2026-10-13")).toBe(false);
    expect(endDateAlertDue(null, "2026-10-13")).toBe(false);
  });

  const base = { allowanceKm: 100_000, startDate: "2026-01-01", endDate: "2027-01-01", startKm: 10_000, today: "2026-07-02" };

  it("dans le forfait au prorata", () => {
    const r = evaluateKmAllowance({ ...base, currentKm: 50_000 })!;
    expect(r.drivenKm).toBe(40_000);
    expect(r.elapsedRatio).toBeCloseTo(0.5, 2);
    expect(r.prorataKm).toBeCloseTo(50_000, -3);
    expect(r.level).toBe("ok");
  });

  it("dépassement prévu au rythme actuel", () => {
    const r = evaluateKmAllowance({ ...base, currentKm: 70_000 })!;
    expect(r.projectedKm).toBeGreaterThan(100_000);
    expect(r.level).toBe("surveiller");
  });

  it("proche puis dépassé", () => {
    expect(evaluateKmAllowance({ ...base, currentKm: 101_000 })!.level).toBe("proche");
    expect(evaluateKmAllowance({ ...base, currentKm: 110_000 })!.level).toBe("depasse");
  });

  it("pas de projection en tout début de contrat", () => {
    const r = evaluateKmAllowance({ ...base, today: "2026-01-10", currentKm: 15_000 })!;
    expect(r.level).toBe("ok");
  });

  it("données incohérentes", () => {
    expect(evaluateKmAllowance({ ...base, endDate: "2025-12-01", currentKm: 1 })).toBeNull();
    expect(evaluateKmAllowance({ ...base, allowanceKm: 0, currentKm: 1 })).toBeNull();
  });
});

describe("dépôt de facture", () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  it("accepte un PDF réel", () => {
    expect(validateInvoiceFile({ declaredType: "application/pdf", size: 1000, head: pdf })).toEqual({ ok: true, mime: "application/pdf", extension: "pdf" });
  });

  it("refuse type, signature ou taille invalides", () => {
    expect(validateInvoiceFile({ declaredType: "text/html", size: 10, head: pdf }).ok).toBe(false);
    expect(validateInvoiceFile({ declaredType: "application/pdf", size: 10, head: png }).ok).toBe(false);
    expect(validateInvoiceFile({ declaredType: "image/png", size: 11 * 1024 * 1024, head: png }).ok).toBe(false);
    expect(validateInvoiceFile({ declaredType: "image/png", size: 0, head: png }).ok).toBe(false);
  });

  it("chemin préfixé par l'organisation", () => {
    expect(invoiceStoragePath("org", "req", "f", "pdf")).toBe("org/req/f.pdf");
  });
});

describe("e-mail prestataire", () => {
  it("échappe le contenu saisi", () => {
    expect(escapeHtml(`<a href="x">'&`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
    const { subject, html } = renderProviderRequestEmail({
      organizationName: "Transports Martin",
      providerName: "Loc'Auto",
      registration: "AB-123-CD",
      vehicleModel: "Renault Master",
      currentKm: 123456,
      contractRef: "LLD-42",
      requestType: "Freins",
      urgency: "high",
      description: "<script>alert(1)</script>",
      createdAt: "2026-10-13T08:00:00Z",
      photoUrls: ["https://exemple.test/p1"],
      contactName: "Julien Roux",
      contactEmail: "julien@exemple.test",
      contactPhone: null,
      providerLink: "https://godac.app/prestataire/abc",
      linkExpiresAt: "2026-11-12T08:00:00Z",
    });
    expect(subject).toContain("AB-123-CD");
    expect(subject).toContain("urgence haute");
    expect(html).not.toContain("<script>");
    expect(html).toContain("123 456 km");
    expect(html).toContain("https://godac.app/prestataire/abc");
    expect(html).toContain("Photo 1");
  });
});
