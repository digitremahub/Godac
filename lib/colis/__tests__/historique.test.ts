import { describe, expect, it } from "vitest";
import { agregerArrets, camionDeTournee, decalerJour, filtrerLignes, jourParis, lireFiltres, paginer, versParams } from "@/lib/colis/historique";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const V = "33333333-3333-4333-8333-333333333333";

describe("lireFiltres", () => {
  it("par défaut : les 30 derniers jours, page 1", () => {
    expect(lireFiltres({}, "2026-10-13")).toEqual({ du: "2026-09-14", au: "2026-10-13", service: null, chauffeur: null, camion: null, page: 1 });
  });
  it("lit les paramètres valides, ignore les autres, remet les bornes dans l'ordre", () => {
    const f = lireFiltres({ du: "2026-10-10", au: "2026-10-01", service: A, chauffeur: "pas-un-uuid", camion: [V], page: "3" }, "2026-10-13");
    expect(f).toEqual({ du: "2026-10-01", au: "2026-10-10", service: A, chauffeur: null, camion: V, page: 3 });
    expect(lireFiltres({ du: "2026-02-30", page: "-2" }, "2026-10-13")).toMatchObject({ du: "2026-09-14", page: 1 });
  });
  it("aller-retour URL", () => {
    const f = lireFiltres({ du: "2026-10-01", chauffeur: B, page: "2" }, "2026-10-13");
    const q = versParams(f, "2026-10-13", { tournee: A });
    expect(q.get("onglet")).toBeNull();
    expect(q.has("au")).toBe(false);
    expect(lireFiltres(Object.fromEntries(q), "2026-10-13")).toEqual(f);
    expect(q.get("tournee")).toBe(A);
  });
});

describe("decalerJour / jourParis", () => {
  it("change de mois et d'année", () => {
    expect(decalerJour("2026-03-01", -1)).toBe("2026-02-28");
    expect(decalerJour("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("jour de Paris d'un instant UTC", () => {
    expect(jourParis("2026-10-12T22:30:00Z")).toBe("2026-10-13"); // 00:30 à Paris (été)
    expect(jourParis("2026-01-12T22:30:00Z")).toBe("2026-01-12"); // 23:30 à Paris (hiver)
  });
});

describe("camionDeTournee", () => {
  const planning = [
    { driver_id: A, vehicle_id: "v-autre-jour", start_at: "2026-10-11T06:00:00Z" },
    { driver_id: A, vehicle_id: "v-tard", start_at: "2026-10-12T14:00:00Z" },
    { driver_id: A, vehicle_id: "v-tot", start_at: "2026-10-12T05:00:00Z" },
    { driver_id: B, vehicle_id: "v-b", start_at: "2026-10-12T05:00:00Z" },
  ];
  it("garde le camion de la tournée s'il est connu", () => {
    expect(camionDeTournee({ driver_id: A, run_date: "2026-10-12", vehicle_id: V }, planning)).toBe(V);
  });
  it("sinon le premier camion du planning du chauffeur ce jour-là", () => {
    expect(camionDeTournee({ driver_id: A, run_date: "2026-10-12" }, planning)).toBe("v-tot");
    expect(camionDeTournee({ driver_id: A, run_date: "2026-10-10" }, planning)).toBeNull();
  });
});

describe("filtrerLignes / paginer", () => {
  const lignes = [
    { id: "1", driver_id: A, run_date: "2026-10-12", camion: V, services: ["s1"] },
    { id: "2", driver_id: B, run_date: "2026-10-12", camion: null, services: ["s1", "s2"] },
    { id: "3", driver_id: A, run_date: "2026-10-11", camion: null, services: [] },
  ];
  it("service, chauffeur et camion se cumulent", () => {
    expect(filtrerLignes(lignes, { service: "s1", chauffeur: null, camion: null }).map((l) => l.id)).toEqual(["1", "2"]);
    expect(filtrerLignes(lignes, { service: "s1", chauffeur: A, camion: null }).map((l) => l.id)).toEqual(["1"]);
    expect(filtrerLignes(lignes, { service: null, chauffeur: null, camion: V }).map((l) => l.id)).toEqual(["1"]);
    expect(filtrerLignes(lignes, { service: null, chauffeur: null, camion: null })).toHaveLength(3);
  });
  it("pages de 25, page ramenée dans les bornes", () => {
    const items = Array.from({ length: 60 }, (_, i) => i);
    expect(paginer(items, 1)).toMatchObject({ page: 1, pages: 3, total: 60 });
    expect(paginer(items, 3).items).toEqual([50, 51, 52, 53, 54, 55, 56, 57, 58, 59]);
    expect(paginer(items, 9).page).toBe(3);
    expect(paginer([], 2)).toMatchObject({ items: [], page: 1, pages: 1, total: 0 });
  });
});

describe("agregerArrets", () => {
  it("compte arrêts, livrés, échecs, colis, fin et km", () => {
    const depot = { lat: 45.75, lng: 4.85 };
    const c = agregerArrets(
      [
        { status: "delivered", parcel_count: 2, done_at: "2026-10-12T08:00:00Z", lat: 45.75, lng: 4.86, position: 0 },
        { status: "failed", parcel_count: 1, done_at: "2026-10-12T09:00:00Z", lat: "45.75", lng: "4.87", position: 1 },
        { status: "pending", parcel_count: 1, done_at: null, lat: 45.75, lng: 4.88, position: 2 },
      ],
      depot,
      true,
    );
    expect(c).toMatchObject({ arrets: 3, livres: 1, echecs: 1, colis: 4, fin: "2026-10-12T09:00:00Z" });
    // Dépôt → 4.86 → 4.87, sans retour (tournée pas finie) : ≈ 1,6 km × 1,3.
    expect(c.km).toBeGreaterThan(1.5);
    expect(c.km).toBeLessThan(2.5);
  });
  it("tournée vide ou sans coordonnées", () => {
    expect(agregerArrets([], null, true)).toEqual({ arrets: 0, livres: 0, echecs: 0, colis: 0, fin: null, km: null });
  });
});

import { lireRecherche, nettoyerRecherche } from "@/lib/colis/historique";

describe("recherche d'un colis dans l'historique", () => {
  it("nettoie le texte (filtre PostgREST) et exige 3 caractères", () => {
    expect(nettoyerRecherche("  6A123,(x)  ")).toBe("6A123 x");
    expect(nettoyerRecherche("ab")).toBeNull();
    expect(nettoyerRecherche("1%*")).toBeNull();
    expect(nettoyerRecherche(null)).toBeNull();
  });

  it("lit la recherche et le statut depuis l'URL", () => {
    expect(lireRecherche({ q: "Dupont", statut: "failed" })).toEqual({ q: "Dupont", statut: "failed" });
    expect(lireRecherche({ q: ["XY12345"], statut: "nimporte" })).toEqual({ q: "XY12345", statut: null });
    expect(lireRecherche({})).toEqual({ q: null, statut: null });
  });
});
