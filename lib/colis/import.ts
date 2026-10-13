/**
 * Import d'une liste d'arrêts depuis Google Maps et les formats courants,
 * pour l'optimiser dans GODAC. Fonctions pures (testées) : la résolution
 * des liens courts maps.app.goo.gl se fait côté serveur
 * (app/api/colis/import), le géocodage des adresses aussi.
 */
import { extraireTelephone, normaliserTelephone } from "@/lib/colis/telephone";

export interface PointImporte {
  adresse: string | null;
  lat: number | null;
  lng: number | null;
  nom: string | null;
  /** Téléphone du destinataire, quand la source le donne. */
  telephone?: string | null;
}

const COORD = /^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/;

function point(texte: string, nom: string | null = null): PointImporte | null {
  const t = texte.replace(/\+/g, " ").trim();
  if (!t) return null;
  const c = t.match(COORD);
  if (c) return { adresse: null, lat: Number(c[1]), lng: Number(c[2]), nom };
  return { adresse: t, lat: null, lng: null, nom };
}

/**
 * Itinéraire Google Maps : https://www.google.com/maps/dir/Adresse+1/Adresse+2/…
 * ou https://www.google.com/maps/dir/?api=1&origin=…&destination=…&waypoints=a|b
 * La première étape (souvent « Ma position ») est ignorée si elle est vide.
 */
export function lireLienGoogleMaps(url: string): PointImporte[] {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return [];
  }
  const p = u.searchParams;
  if (p.get("api") === "1" || p.has("destination")) {
    const etapes = [p.get("origin"), ...(p.get("waypoints") ?? "").split("|"), p.get("destination")];
    return etapes.map((e) => (e ? point(e) : null)).filter((x): x is PointImporte => x !== null);
  }
  const i = u.pathname.indexOf("/dir/");
  if (i >= 0) {
    return u.pathname
      .slice(i + 5)
      .split("/")
      .filter((seg) => seg && !seg.startsWith("@") && !seg.startsWith("data="))
      .map((seg) => {
        try {
          return decodeURIComponent(seg);
        } catch {
          return seg;
        }
      })
      .filter((seg) => !/^(ma position|my location|votre position|your location)$/i.test(seg.replace(/\+/g, " ").trim()))
      .map((seg) => point(seg))
      .filter((x): x is PointImporte => x !== null);
  }
  const q = p.get("q") ?? p.get("query") ?? p.get("daddr");
  return q ? [point(q)].filter((x): x is PointImporte => x !== null) : [];
}

/** Une adresse (ou « lat, lng ») par ligne. */
export function lireListe(texte: string): PointImporte[] {
  return texte
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*\d+[.)-]\s+/, "").trim())
    .filter((l) => l.length >= 5)
    .map((l) => {
      // « 12 rue des Lilas, 69230 Saint-Genis — 06 12 34 56 78 » : le numéro devient le téléphone.
      const telephone = COORD.test(l) ? null : extraireTelephone(l);
      if (!telephone) return point(l);
      const sansTel = l.replace(/[\s,;–—-]*(t[ée]l[ée]?(phone)?\s*[:.]?\s*)?(\+|00)?[\d][\d\s.()-]{8,}\d\s*$/i, "").trim();
      const p = point(sansTel.length >= 5 ? sansTel : l);
      return p ? { ...p, telephone } : null;
    })
    .filter((x): x is PointImporte => x !== null);
}

function lireCsv(texte: string): PointImporte[] {
  const lignes = texte.split(/\r?\n/).filter((l) => l.trim());
  if (!lignes.length) return [];
  const sep = (lignes[0]!.match(/;/g)?.length ?? 0) > (lignes[0]!.match(/,/g)?.length ?? 0) ? ";" : ",";
  const cellules = (l: string) => {
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i]!;
      if (ch === '"') {
        if (q && l[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = !q;
      } else if (ch === sep && !q) {
        out.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const tete = cellules(lignes[0]!).map((h) => h.toLowerCase());
  const idx = (...noms: string[]) => tete.findIndex((h) => noms.some((n) => h === n || h.includes(n)));
  const iAdr = idx("address", "adresse", "addr");
  const iLat = idx("latitude", "lat");
  const iLng = idx("longitude", "lng", "lon");
  const iNom = idx("title", "titre", "name", "nom", "destinataire");
  const iUrl = idx("url");
  const iCp = idx("postal", "code postal", "cp", "zip");
  const iVille = idx("city", "ville");
  const iTel = idx("phone", "téléphone", "telephone", "tél", "mobile", "portable");
  // Pas d'en-tête reconnu : une adresse par ligne.
  if (iAdr < 0 && iLat < 0 && iUrl < 0) return lireListe(lignes.map((l) => cellules(l).filter(Boolean).join(", ")).join("\n"));
  const res: PointImporte[] = [];
  for (const l of lignes.slice(1)) {
    const c = cellules(l);
    const telephone = iTel >= 0 ? normaliserTelephone(c[iTel]) : null;
    const debut = res.length;
    const nom = iNom >= 0 ? c[iNom] || null : null;
    const lat = iLat >= 0 ? Number(c[iLat]) : NaN;
    const lng = iLng >= 0 ? Number(c[iLng]) : NaN;
    let adresse = iAdr >= 0 ? c[iAdr] || null : null;
    if (adresse && (iCp >= 0 || iVille >= 0)) adresse = [adresse, [iCp >= 0 ? c[iCp] : "", iVille >= 0 ? c[iVille] : ""].join(" ").trim()].filter(Boolean).join(", ");
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0) res.push({ adresse, lat, lng, nom });
    else if (adresse) res.push({ adresse, lat: null, lng: null, nom });
    else if (iUrl >= 0 && c[iUrl]) {
      // Liste Google enregistrée : l'URL porte souvent les coordonnées ou le lieu.
      const lien = c[iUrl]!;
      const m = lien.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/) ?? lien.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (m) res.push({ adresse: null, lat: Number(m[1]), lng: Number(m[2]), nom });
      else if (nom) res.push({ adresse: nom, lat: null, lng: null, nom });
    } else if (nom) res.push({ adresse: nom, lat: null, lng: null, nom });
    if (telephone && res.length > debut) res[res.length - 1]!.telephone = telephone;
  }
  return res;
}

function texteBalise(bloc: string, balise: string): string | null {
  const m = bloc.match(new RegExp(`<${balise}[^>]*>([\\s\\S]*?)</${balise}>`, "i"));
  if (!m) return null;
  return m[1]!.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim() || null;
}

function lireKml(texte: string): PointImporte[] {
  const res: PointImporte[] = [];
  for (const bloc of texte.match(/<Placemark[\s\S]*?<\/Placemark>/gi) ?? []) {
    const nom = texteBalise(bloc, "name");
    const adresse = texteBalise(bloc, "address");
    const coords = texteBalise(bloc, "coordinates");
    const c = coords?.split(/\s+/)[0]?.split(",");
    if (c && c.length >= 2 && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1]))) {
      res.push({ adresse, lat: Number(c[1]), lng: Number(c[0]), nom });
    } else if (adresse) res.push({ adresse, lat: null, lng: null, nom });
  }
  return res;
}

function lireGpx(texte: string): PointImporte[] {
  const res: PointImporte[] = [];
  for (const m of texte.matchAll(/<(wpt|rtept)\s+([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const lat = Number(m[2]!.match(/lat="([^"]+)"/)?.[1]);
    const lng = Number(m[2]!.match(/lon="([^"]+)"/)?.[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) res.push({ adresse: texteBalise(m[3]!, "desc"), lat, lng, nom: texteBalise(m[3]!, "name") });
  }
  return res;
}

function lireGeoJson(texte: string): PointImporte[] {
  let data: any;
  try {
    data = JSON.parse(texte);
  } catch {
    return [];
  }
  const features: any[] = data?.type === "FeatureCollection" ? data.features ?? [] : Array.isArray(data) ? data : [];
  return features
    .map((f) => {
      const props = f?.properties ?? {};
      const coords = f?.geometry?.type === "Point" ? f.geometry.coordinates : null;
      const adresse = props.location?.address ?? props.address ?? props.Address ?? null;
      const nom = props.location?.name ?? props.Title ?? props.name ?? props.title ?? null;
      const [lng, lat] = Array.isArray(coords) ? coords : [NaN, NaN];
      const valide = Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
      return valide || adresse ? { adresse, lat: valide ? lat : null, lng: valide ? lng : null, nom } : null;
    })
    .filter((x): x is PointImporte => x !== null);
}

/** Fichier importé : CSV (listes Google, Circuit, Excel), KML (My Maps), GeoJSON (Takeout), GPX, ou texte brut. */
export function lireFichier(nom: string, texte: string): PointImporte[] {
  const ext = nom.toLowerCase().split(".").pop() ?? "";
  if (ext === "kml") return lireKml(texte);
  if (ext === "gpx") return lireGpx(texte);
  if (ext === "geojson" || ext === "json") return lireGeoJson(texte);
  if (ext === "csv" || ext === "tsv") return lireCsv(texte.replace(/\t/g, ";"));
  if (texte.includes("<Placemark")) return lireKml(texte);
  if (texte.includes("<gpx")) return lireGpx(texte);
  return lireListe(texte);
}
