/**
 * Sortie d'une tournée optimisée vers une application externe : liens
 * Google Maps (découpés, Google limitant le nombre d'étapes par lien),
 * CSV (Circuit, Google My Maps, Excel) et GPX (GPS, autres applications).
 */
export interface ArretExport {
  adresse: string;
  lat: number | null;
  lng: number | null;
  destinataire?: string | null;
  colis?: number;
  notes?: string | null;
  telephone?: string | null;
  /** Liste de la tournée (colonne « Liste » du CSV). */
  liste?: string | null;
}

/** Google Maps accepte 9 étapes intermédiaires par lien (plus départ et arrivée). */
export const ETAPES_PAR_LIEN = 9;

const lieu = (a: { adresse: string; lat: number | null; lng: number | null }) => (a.lat !== null && a.lng !== null ? `${a.lat},${a.lng}` : a.adresse);

/**
 * Liens Google Maps successifs couvrant tous les arrêts dans l'ordre :
 * chaque partie repart du dernier arrêt de la précédente. Sans départ,
 * Google part de la position du téléphone.
 */
export function liensGoogleMaps(
  depart: { adresse: string; lat: number | null; lng: number | null } | null,
  arrets: ArretExport[],
  retour: { adresse: string; lat: number | null; lng: number | null } | null = null,
): { label: string; url: string }[] {
  const pts = [...arrets, ...(retour ? [{ ...retour, colis: 0 }] : [])];
  const liens: { label: string; url: string }[] = [];
  let origine = depart;
  let i = 0;
  let partie = 1;
  while (i < pts.length) {
    const lot = pts.slice(i, i + ETAPES_PAR_LIEN + 1);
    const destination = lot[lot.length - 1]!;
    const etapes = lot.slice(0, -1);
    const params = new URLSearchParams({ api: "1", destination: lieu(destination), travelmode: "driving" });
    if (origine) params.set("origin", lieu(origine));
    if (etapes.length) params.set("waypoints", etapes.map(lieu).join("|"));
    const debut = i + 1;
    const fin = Math.min(i + lot.length, arrets.length);
    liens.push({
      label: pts.length <= ETAPES_PAR_LIEN + 1 ? "Itinéraire complet" : `Partie ${partie} · arrêts ${debut} à ${fin}${i + lot.length > arrets.length ? " + retour" : ""}`,
      url: `https://www.google.com/maps/dir/?${params.toString()}`,
    });
    origine = destination;
    i += lot.length;
    partie++;
  }
  return liens;
}

const csvCell = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV avec en-têtes reconnus par Circuit, Google My Maps et Excel (+ colonne « Liste » de GODAC). */
export function versCsv(arrets: ArretExport[]): string {
  const lignes = [["Stop", "Address", "Name", "Phone", "Packages", "Latitude", "Longitude", "Notes", "Liste"].join(",")];
  arrets.forEach((a, i) => {
    lignes.push([i + 1, a.adresse, a.destinataire ?? "", a.telephone ?? "", a.colis ?? 1, a.lat ?? "", a.lng ?? "", a.notes ?? "", a.liste ?? ""].map(csvCell).join(","));
  });
  return "﻿" + lignes.join("\r\n") + "\r\n";
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Itinéraire GPX (rtept dans l'ordre) — les arrêts sans coordonnées sont omis. */
export function versGpx(nom: string, arrets: ArretExport[]): string {
  const pts = arrets
    .map((a, i) =>
      a.lat !== null && a.lng !== null
        ? `    <rtept lat="${a.lat}" lon="${a.lng}"><name>${i + 1}. ${xml(a.destinataire || a.adresse)}</name><desc>${xml(a.adresse)}</desc></rtept>`
        : null,
    )
    .filter(Boolean)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="GODAC" xmlns="http://www.topografix.com/GPX/1/1">\n  <rte>\n    <name>${xml(nom)}</name>\n${pts}\n  </rte>\n</gpx>\n`;
}
