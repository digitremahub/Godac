import { describe, expect, it } from "vitest";
import { liensGoogleMaps, versCsv, versGpx, ETAPES_PAR_LIEN } from "@/lib/colis/export";
import { lireFichier } from "@/lib/colis/import";

const arrets = Array.from({ length: 23 }, (_, i) => ({ adresse: `${i + 1} rue Test, 69000 Lyon`, lat: Math.round((45.7 + i / 1000) * 1e6) / 1e6, lng: 4.8, colis: 1 }));

describe("liensGoogleMaps", () => {
  it("découpe en parties de 10 arrêts au plus, chaque partie repart du dernier arrêt", () => {
    const depot = { adresse: "Dépôt", lat: 45.73, lng: 4.83 };
    const liens = liensGoogleMaps(depot, arrets, depot);
    expect(liens).toHaveLength(3); // 23 arrêts + retour = 24 points
    const u1 = new URL(liens[0]!.url);
    expect(u1.searchParams.get("origin")).toBe("45.73,4.83");
    expect(u1.searchParams.get("waypoints")!.split("|")).toHaveLength(ETAPES_PAR_LIEN);
    const u2 = new URL(liens[1]!.url);
    expect(u2.searchParams.get("origin")).toBe(u1.searchParams.get("destination"));
    expect(new URL(liens[2]!.url).searchParams.get("destination")).toBe("45.73,4.83");
  });
  it("une seule partie pour une petite tournée", () => {
    expect(liensGoogleMaps(null, arrets.slice(0, 5))[0]!.label).toBe("Itinéraire complet");
  });
});

describe("CSV / GPX", () => {
  it("le CSV exporté se réimporte à l'identique", () => {
    const r = lireFichier("t.csv", versCsv(arrets.slice(0, 3)).replace(/^﻿/, ""));
    expect(r.map((p) => p.lat)).toEqual([45.7, 45.701, 45.702]);
  });
  it("colonne « Liste » remplie, sans gêner la réimportation", () => {
    const csv = versCsv(arrets.slice(0, 2).map((a, i) => ({ ...a, liste: i ? "Liste 2" : "Amazon, matin" })));
    const [entete, l1, l2] = csv.replace(/^﻿/, "").split("\r\n");
    expect(entete!.split(",").at(-1)).toBe("Liste");
    expect(l1!.endsWith(`,"Amazon, matin"`)).toBe(true);
    expect(l2!.endsWith(",Liste 2")).toBe(true);
    const r = lireFichier("t.csv", csv.replace(/^﻿/, ""));
    expect(r.map((p) => p.adresse)).toEqual([arrets[0]!.adresse, arrets[1]!.adresse]);
  });
  it("GPX valide avec les arrêts dans l'ordre", () => {
    const g = versGpx("Tournée & co", arrets.slice(0, 2));
    expect(g).toContain("<name>Tournée &amp; co</name>");
    expect(g.match(/<rtept/g)).toHaveLength(2);
  });
});
