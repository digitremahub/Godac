import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COLONNES_CLIENT_EFFACEES, RETENTION_FICHES_CLIENT_JOURS, decisionFiche, limiteFichesClient } from "@/lib/retention/fiches-client";

const maintenant = new Date("2026-10-28T12:00:00Z");
const ilYA = (jours: number) => new Date(maintenant.getTime() - jours * 86_400_000).toISOString();

describe("durée de conservation des fiches client : 12 mois sans mise à jour", () => {
  it("365 jours", () => {
    expect(RETENTION_FICHES_CLIENT_JOURS).toBe(365);
    expect(limiteFichesClient(maintenant)).toBe("2025-10-28T12:00:00.000Z");
  });

  it("une fiche récente est gardée, même sans horaires", () => {
    expect(decisionFiche({ updated_at: ilYA(10), weekly_schedule: {} }, maintenant)).toBe("garder");
    expect(decisionFiche({ updated_at: ilYA(364), weekly_schedule: {} }, maintenant)).toBe("garder");
  });

  it("une fiche périmée sans horaires est supprimée", () => {
    expect(decisionFiche({ updated_at: ilYA(366), weekly_schedule: {} }, maintenant)).toBe("supprimer");
    expect(decisionFiche({ updated_at: ilYA(900), weekly_schedule: null }, maintenant)).toBe("supprimer");
  });

  it("une fiche périmée avec horaires est anonymisée (horaires et adresse conservés)", () => {
    expect(decisionFiche({ updated_at: ilYA(400), weekly_schedule: { "1": [{ open: "08:00", close: "12:00" }] } }, maintenant)).toBe("anonymiser");
    // Jour fermé = liste vide, mais l'horaire est une information d'entreprise renseignée.
    expect(decisionFiche({ updated_at: ilYA(400), weekly_schedule: { "7": [] } }, maintenant)).toBe("anonymiser");
  });

  it("l'anonymisation efface toutes les données du client mais ni le nom, ni l'adresse, ni les horaires", () => {
    const cles = Object.keys(COLONNES_CLIENT_EFFACEES);
    for (const c of ["phone", "recipient", "access_notes", "delivered_count", "failed_count", "success_by_hour", "failure_reasons", "contact_message_count", "contact_phone_count", "service_avg_min", "lat", "lng"]) expect(cles).toContain(c);
    for (const c of ["label", "address", "address_key", "weekly_schedule", "organization_id", "updated_at"]) expect(cles).not.toContain(c);
  });
});

describe("branchement dans la purge quotidienne", () => {
  const purge = readFileSync("lib/retention/purge.ts", "utf8");
  it("le cron de rétention existant purge les fiches (pas de nouveau cron)", () => {
    expect(purge).toContain("purgerFichesClient(admin)");
    expect(purge).toContain("clientFiches: RETENTION_FICHES_CLIENT_JOURS");
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")).crons as { path: string; schedule: string }[];
    expect(vercel.filter((c) => c.path === "/api/cron/retention")).toHaveLength(1);
    // Quotidien (jamais plus fréquent) : minute et heure fixes, tous les jours.
    expect(vercel.find((c) => c.path === "/api/cron/retention")!.schedule).toMatch(/^\d+ \d+ \* \* \*$/);
  });
  it("la purge ne supprime que ce qui est périmé et sans horaires, et anonymise le reste", () => {
    expect(purge).toMatch(/delete\(\{ count: "exact" \}\)\.lt\("updated_at", limite\)\.filter\("weekly_schedule", "eq", "\{\}"\)/);
    expect(purge).toContain(".update(COLONNES_CLIENT_EFFACEES");
    expect(purge).toContain('from("tournee_sens").delete');
  });
  it("les textes publiés annoncent 12 mois sans mise à jour et mentionnent les catégories de données", () => {
    const conf = readFileSync("app/confidentialite/page.tsx", "utf8");
    expect(conf).toContain("coordonnées des");
    expect(conf).toContain("consignes d&apos;accès");
    expect(conf).toMatch(/Fiches client de l&apos;annuaire de tournée\*[\s\S]*12 mois sans mise à jour/);
    const dpa = readFileSync("app/dpa/page.tsx", "utf8");
    expect(dpa).toContain("Annuaire client de tournée");
    expect(dpa).toContain("consignes d’accès");
    expect(dpa).toContain("conservé 12 mois sans mise à jour");
  });
});
