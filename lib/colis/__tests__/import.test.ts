import { describe, expect, it } from "vitest";
import { extraireLien, idListeGoogle, lireFichier, lireLienGoogleMaps, lireListe, lireListeGoogle } from "@/lib/colis/import";

describe("lireLienGoogleMaps", () => {
  it("itinéraire /dir/ avec adresses et coordonnées", () => {
    const r = lireLienGoogleMaps(
      "https://www.google.com/maps/dir/Ma+position/12+Rue+des+Lilas,+69230+Saint-Genis-Laval/45.7123,4.7890/3+Avenue+Foch,+69006+Lyon/@45.7,4.8,12z/data=!3m1",
    );
    expect(r).toEqual([
      { adresse: "12 Rue des Lilas, 69230 Saint-Genis-Laval", lat: null, lng: null, nom: null },
      { adresse: null, lat: 45.7123, lng: 4.789, nom: null },
      { adresse: "3 Avenue Foch, 69006 Lyon", lat: null, lng: null, nom: null },
    ]);
  });
  it("lien api=1 avec waypoints", () => {
    const r = lireLienGoogleMaps("https://www.google.com/maps/dir/?api=1&origin=Lyon&destination=Brignais&waypoints=Chaponost|Oullins");
    expect(r.map((p) => p.adresse)).toEqual(["Lyon", "Chaponost", "Oullins", "Brignais"]);
  });
  it("lien invalide", () => {
    expect(lireLienGoogleMaps("pas un lien")).toEqual([]);
  });
});

describe("lireListe et fichiers", () => {
  it("liste collée, numérotée ou non", () => {
    expect(lireListe("1. 12 rue des Lilas, 69230 Saint-Genis-Laval\n\n2) 3 avenue Foch, 69006 Lyon\nok").length).toBe(2);
  });
  it("CSV de liste Google enregistrée (Title, Note, URL)", () => {
    const csv = 'Title,Note,URL,Comment\nBoulangerie,,"https://www.google.com/maps/search/?api=1&q=45.71,4.79",\nGarage Rey,,"https://www.google.com/maps/place/Garage+Rey/@45.65,4.72,17z",';
    const r = lireFichier("liste.csv", csv);
    expect(r).toEqual([
      { adresse: null, lat: 45.71, lng: 4.79, nom: "Boulangerie" },
      { adresse: null, lat: 45.65, lng: 4.72, nom: "Garage Rey" },
    ]);
  });
  it("CSV avec colonnes adresse / code postal / ville", () => {
    const r = lireFichier("export.csv", 'Nom;Adresse;CP;Ville\nDupont;"1 chemin du Moulin";69510;Soucieu');
    expect(r[0]).toEqual({ adresse: "1 chemin du Moulin, 69510 Soucieu", lat: null, lng: null, nom: "Dupont" });
  });
  it("KML My Maps", () => {
    const kml = `<kml><Document><Placemark><name>Client A</name><Point><coordinates>4.79,45.71,0</coordinates></Point></Placemark><Placemark><name>B</name><address>3 avenue Foch, 69006 Lyon</address></Placemark></Document></kml>`;
    expect(lireFichier("carte.kml", kml)).toEqual([
      { adresse: null, lat: 45.71, lng: 4.79, nom: "Client A" },
      { adresse: "3 avenue Foch, 69006 Lyon", lat: null, lng: null, nom: "B" },
    ]);
  });
  it("GeoJSON Google Takeout", () => {
    const gj = JSON.stringify({ type: "FeatureCollection", features: [{ geometry: { type: "Point", coordinates: [4.79, 45.71] }, properties: { location: { name: "Client", address: "12 rue des Lilas, Saint-Genis-Laval" } } }] });
    expect(lireFichier("Saved Places.json", gj)).toEqual([{ adresse: "12 rue des Lilas, Saint-Genis-Laval", lat: 45.71, lng: 4.79, nom: "Client" }]);
  });
  it("GPX", () => {
    expect(lireFichier("t.gpx", '<gpx><wpt lat="45.7" lon="4.8"><name>Arrêt 1</name></wpt></gpx>')).toEqual([{ adresse: null, lat: 45.7, lng: 4.8, nom: "Arrêt 1" }]);
  });
});

describe("téléphones importés", () => {
  it("colonne téléphone d'un CSV", () => {
    const r = lireFichier("l.csv", "Adresse;Nom;Téléphone\n12 rue des Lilas 69230 Saint-Genis;Martin;0612345678\n");
    expect(r[0]!.telephone).toBe("06 12 34 56 78");
  });
  it("numéro en fin de ligne d'une liste", () => {
    const [p] = lireListe("12 rue des Lilas, 69230 Saint-Genis-Laval - 06 12 34 56 78");
    expect(p).toEqual({ adresse: "12 rue des Lilas, 69230 Saint-Genis-Laval", lat: null, lng: null, nom: null, telephone: "06 12 34 56 78" });
  });
});

describe("listes Google Maps partagées", () => {
  it("extrait le lien d'un texte partagé", () => {
    expect(extraireLien("Regarde ma liste « Tournée 12 » sur Google Maps : https://maps.app.goo.gl/AbCdEf123.")).toBe("https://maps.app.goo.gl/AbCdEf123");
    expect(extraireLien("aucun lien")).toBeNull();
  });
  it("identifiant de liste", () => {
    expect(idListeGoogle("https://www.google.com/maps/placelists/list/2Abc_dEfGhIjK123?g_ep=x")).toBe("2Abc_dEfGhIjK123");
    expect(idListeGoogle("https://www.google.com/maps/@45.7,4.8,12z/data=!4m3!11m2!2sXyZ987_abcDEF!3e3")).toBe("XyZ987_abcDEF");
    expect(idListeGoogle("https://www.google.com/maps/dir/A/B")).toBeNull();
  });
  it("lit les lieux de l'aperçu de liste", () => {
    const lieu = (nom: string, adresse: string, lat: number, lng: number) => [null, [null, null, "", null, adresse, [null, null, lat, lng], ["0x47f4:0x1"]], nom, ""];
    const reponse = `)]}'\n${JSON.stringify([[null, "id", null, null, "Ma liste", null, null, null, [lieu("Boulangerie", "12 Rue des Lilas, 69230 Saint-Genis-Laval", 45.69, 4.79), lieu("Client B", "3 Avenue Foch, 69006 Lyon", 45.77, 4.84)]]])}`;
    const pts = lireListeGoogle(reponse);
    expect(pts).toHaveLength(2);
    expect(pts[0]).toMatchObject({ lat: 45.69, lng: 4.79, adresse: "12 Rue des Lilas, 69230 Saint-Genis-Laval" });
    expect(lireListeGoogle("pas du json")).toEqual([]);
  });
});
