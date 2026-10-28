import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MINUTES_PAR_ARRET, estimerAvancement, serviceArret } from "@/lib/colis/estimation";
import { ordonnerAvecHoraires, passagesTournee, simulerPassages } from "@/lib/colis/horaires";
import { sequenceParListes } from "@/lib/colis/listes";
import { filtrerAnnuaire } from "@/lib/colis/recherche-adresses";
import { resumeFiche } from "@/lib/colis/fiche-client";
import type { Point } from "@/lib/colis/optimisation";

const depot: Point = { lat: 45, lng: 5 };
const ici = depot;

describe("durée d'arrêt observée dans les heures de passage", () => {
  it("sans durée connue : 3 min par arrêt, comme avant", () => {
    const r = simulerPassages({ point: ici, minute: 480 }, [{ point: ici, fenetres: null }, { point: ici, fenetres: null }]);
    expect(r.passages.map((p) => p.arrivee)).toEqual([480, 483]);
    expect(r.fin).toBe(486);
  });
  it("avec une durée par arrêt : elle remplace la valeur fixe pour cet arrêt seulement", () => {
    const r = simulerPassages({ point: ici, minute: 480 }, [{ point: ici, fenetres: null, service: 10 }, { point: ici, fenetres: null }, { point: ici, fenetres: null, service: 1 }]);
    expect(r.passages.map((p) => p.arrivee)).toEqual([480, 490, 493]);
    expect(r.fin).toBe(494);
  });
  it("passagesTournee tient compte de la durée de chaque arrêt restant", () => {
    const m = passagesTournee(
      [
        { id: "a", status: "pending", lat: ici.lat, lng: ici.lng, fenetres: null, service: 12 },
        { id: "b", status: "pending", lat: ici.lat, lng: ici.lng, fenetres: null },
      ],
      { point: ici, minute: 600 },
    );
    expect(m.get("b")!.arrivee).toBe(612);
  });
  it("une durée longue peut faire manquer la fermeture : l'optimisation avec horaires en tient compte", () => {
    // Deux arrêts au même endroit : Z ferme à 8h15, Y reste ouvert. Y dure 20 min : Z doit passer d'abord.
    const arrets = [
      { point: ici, fenetres: [[0, 495]] as [number, number][] }, // Z : fermé après 8h15
      { point: ici, fenetres: null, service: 20 }, // Y
    ];
    const r = ordonnerAvecHoraires(null, arrets, { debut: 480, retour: false, strategie: "optimal" });
    expect(r.ordre[0]).toBe(0);
  });
});

describe("sequenceParListes : durée d'arrêt par adresse", () => {
  const arrets = [
    { id: "a", list_id: null, position: 0, status: "pending", lat: 45.0, lng: 5.0 },
    { id: "b", list_id: null, position: 1, status: "pending", lat: 45.0, lng: 5.0 },
  ];
  const base = { debut: 480, fenetres: () => null };
  it("valeur fixe sans durée apprise", () => {
    const r = sequenceParListes(arrets, [], depot, false, base);
    expect(r.fin).toBe(480 + 2 * MINUTES_PAR_ARRET);
  });
  it("durée apprise utilisée par adresse (id), valeur fixe pour les autres", () => {
    const r = sequenceParListes(arrets, [], depot, false, { ...base, service: (id) => (id === "a" ? 9 : undefined) });
    expect(r.fin).toBe(480 + 9 + MINUTES_PAR_ARRET);
  });
});

describe("heure de fin estimée (ETA)", () => {
  const maintenant = new Date("2026-10-28T08:00:00Z");
  const arrets = (service?: number) => [
    { status: "pending" as const, parcel_count: 1, lat: 45, lng: 5, done_at: null, ...(service !== undefined ? { service_min: service } : {}) },
    { status: "pending" as const, parcel_count: 1, lat: 45, lng: 5, done_at: null, ...(service !== undefined ? { service_min: service } : {}) },
  ];
  const fin = (a: ReturnType<typeof arrets>) => Date.parse(estimerAvancement(a, { maintenant, position: ici })!.finEstimee!);
  it("serviceArret : observée si valide, sinon 3 min", () => {
    expect(serviceArret({ service_min: 7 })).toBe(7);
    expect(serviceArret({ service_min: null })).toBe(MINUTES_PAR_ARRET);
    expect(serviceArret({ service_min: 0 })).toBe(MINUTES_PAR_ARRET);
    expect(serviceArret({ service_min: Number.NaN })).toBe(MINUTES_PAR_ARRET);
    expect(serviceArret({})).toBe(MINUTES_PAR_ARRET);
  });
  it("la durée observée remplace les 3 minutes fixes", () => {
    expect(fin(arrets())).toBe(maintenant.getTime() + 2 * MINUTES_PAR_ARRET * 60_000);
    expect(fin(arrets(10))).toBe(maintenant.getTime() + 20 * 60_000);
  });
});

describe("annuaire interne : fiches client en premier, sans doublon", () => {
  const fiche = resumeFiche({ phone: "05 56 12 34 56", service_avg_min: 4, service_samples: 3, delivered_count: 1, failed_count: 2, failure_reasons: { absent: 2 } });
  it("une suggestion de l'annuaire porte le téléphone, la durée et l'alerte d'échec", () => {
    const r = filtrerAnnuaire([{ nom: "Pharmacie du Port", adresse: "1 quai du Port, 33000 Bordeaux", fiche }], "pharmacie port");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ source: "annuaire", type: "etablissement", detail: "Déjà livré par votre équipe · 05 56 12 34 56 · ≈ 4 min d'arrêt" });
    expect(r[0]!.fiche?.echec).toContain("Échec fréquent ici");
  });
  it("l'adresse déjà connue par un arrêt passé n'est pas proposée deux fois ; la fiche l'emporte", () => {
    const r = filtrerAnnuaire(
      [
        { nom: "Pharmacie du Port", adresse: "1 quai du Port, 33000 Bordeaux" },
        { nom: "Pharmacie du Port", adresse: "1 quai du Port, 33000 Bordeaux", fiche },
      ],
      "pharmacie",
    );
    expect(r).toHaveLength(1);
    expect(r[0]!.fiche).toBeTruthy();
  });
  it("sans fiche : le détail historique est conservé", () => {
    expect(filtrerAnnuaire([{ nom: "Boulangerie", adresse: "2 rue Haute, 33000 Bordeaux" }], "boulangerie")[0]!.detail).toBe("Déjà livré par votre équipe");
  });
  it("la limite et la correspondance par mots restent respectées", () => {
    const entrees = Array.from({ length: 10 }, (_, i) => ({ nom: `Café ${i}`, adresse: `${i} rue Haute, 33000 Bordeaux` }));
    expect(filtrerAnnuaire(entrees, "café", 4)).toHaveLength(4);
    expect(filtrerAnnuaire(entrees, "inconnu")).toHaveLength(0);
  });
});

describe("routes : accès restreint à l'organisation et au rôle", () => {
  const lire = (f: string) => readFileSync(f, "utf8");
  it("la route du sens de tournée est gardée (garderApi, module, organisation)", () => {
    const r = lire("app/api/colis/sens/route.ts");
    expect(r).toContain("garderApi");
    expect(r).toContain('modules: ["route_optimizer"]');
    expect(r).toContain("moduleActif");
    expect(r).toContain("organization_id");
  });
  it("la fiche client s'enregistre et s'efface via la route des horaires, réservée aux chauffeurs et à l'encadrement", () => {
    const r = lire("app/api/colis/horaires/route.ts");
    expect(r).toContain('const PEUVENT_ECRIRE = ["chauffeur", "manager", "exploitation", "direction"]');
    expect(r).toMatch(/export async function DELETE[\s\S]*contexte\(true\)[\s\S]*\.delete\(\)\.eq\("organization_id"/);
    expect(r).toMatch(/export async function PUT[\s\S]*contexte\(true\)/);
  });
  it("l'apprentissage est branché sur la clôture d'un arrêt (deux chemins) et d'une tournée", () => {
    expect(lire("app/api/colis/arrets/[id]/route.ts")).toContain("enregistrerObservationArret");
    expect(lire("app/api/colis/arrets/[id]/livraison/route.ts")).toContain("enregistrerObservationArret");
    expect(lire("app/api/colis/tournees/[id]/route.ts")).toContain("enregistrerSensRun");
  });
  it("l'apprentissage est idempotent et filtré par organisation", () => {
    const s = lire("lib/colis/fiche-client-serveur.ts");
    expect(s).toContain("fiche_enregistree_le");
    expect(s).toContain('.eq("organization_id", organizationId)');
    expect(s).toContain("retenirAdresse");
    expect(s).toContain("upsert");
  });
  it("l'optimisation applique le sens avec garde-fou horaires et mémorise le choix explicite", () => {
    const r = lire("app/api/colis/optimiser/route.ts");
    expect(r).toContain("biaisSansRisque");
    expect(r).toContain("referenceSens");
    expect(r).toContain("parsed.data.sens");
  });
});
