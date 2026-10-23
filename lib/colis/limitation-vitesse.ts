/**
 * Vitesse réelle et limitation de vitesse affichées dans GO Navigation.
 * - Vitesse réelle : celle du GPS (m/s) convertie en km/h.
 * - Limitation : balise OpenStreetMap `maxspeed` de la route la plus proche
 *   (/api/colis/limitation). Indicative : le panneau sur place fait foi.
 */

/** m/s → km/h entier ; null si inconnue. Sous 2 km/h : 0 (bruit du GPS à l'arrêt). */
export function kmhDepuisMs(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v) || v < 0) return null;
  const kmh = v * 3.6;
  return kmh < 2 ? 0 : Math.round(kmh);
}

const PAR_DEFAUT: Record<string, number> = {
  "fr:urban": 50,
  "fr:rural": 80,
  "fr:trunk": 110,
  "fr:motorway": 130,
  "fr:walk": 6,
  "fr:living_street": 20,
  urban: 50,
  rural: 80,
  motorway: 130,
  walk: 6,
  living_street: 20,
};

/** Limitation en km/h depuis la balise OSM `maxspeed` (« 50 », « 30 mph », « FR:urban », « 80;50 »…), null si inexploitable. */
export function lireMaxspeed(tag: string | undefined | null): number | null {
  if (!tag) return null;
  const t = tag.trim().toLowerCase();
  if (PAR_DEFAUT[t] !== undefined) return PAR_DEFAUT[t]!;
  // Valeurs multiples (voies différentes) : la plus prudente.
  const parts = t.split(/[;|]/).map((x) => x.trim());
  const valeurs = parts
    .map((x) => {
      const m = x.match(/^(\d{1,3})(?:\s*(mph|km\/h|kmh))?$/);
      if (!m) return PAR_DEFAUT[x] ?? null;
      const n = Number(m[1]);
      return m[2] === "mph" ? Math.round(n * 1.609) : n;
    })
    .filter((n): n is number => n !== null && n >= 5 && n <= 150);
  return valeurs.length ? Math.min(...valeurs) : null;
}

/** Dépassement de la limitation (tolérance de 3 km/h pour l'imprécision du GPS). */
export function enDepassement(vitesseKmh: number | null, limiteKmh: number | null): boolean {
  return vitesseKmh !== null && limiteKmh !== null && vitesseKmh > limiteKmh + 3;
}

type Pt = { lat: number; lon: number };

/** Distance (m) d'un point à un segment, en projection locale plane. */
export function distanceSegmentM(p: { lat: number; lng: number }, a: Pt, b: Pt): number {
  const k = Math.cos((p.lat * Math.PI) / 180);
  const m = 111_320;
  const px = p.lng * k * m, py = p.lat * m;
  const ax = a.lon * k * m, ay = a.lat * m;
  const bx = b.lon * k * m, by = b.lat * m;
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export interface VoieOSM {
  tags?: Record<string, string>;
  geometry?: Pt[];
}

/** Limitation de la voie la plus proche du point (à `rayonM` près) parmi les voies renvoyées par Overpass. */
export function limiteLaPlusProche(p: { lat: number; lng: number }, voies: VoieOSM[], rayonM = 25): { limite: number; route: string | null } | null {
  let meilleur: { d: number; limite: number; route: string | null } | null = null;
  for (const v of voies) {
    const limite = lireMaxspeed(v.tags?.maxspeed);
    const g = v.geometry ?? [];
    if (limite === null || g.length < 2) continue;
    for (let i = 0; i < g.length - 1; i++) {
      const d = distanceSegmentM(p, g[i]!, g[i + 1]!);
      if (d <= rayonM && (!meilleur || d < meilleur.d)) meilleur = { d, limite, route: v.tags?.name ?? v.tags?.ref ?? null };
    }
  }
  return meilleur ? { limite: meilleur.limite, route: meilleur.route } : null;
}
