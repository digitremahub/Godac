/** Types et petits utilitaires partagés par la tournée colis et l'application chauffeur. */
export interface Run {
  id: string;
  name: string | null;
  run_date: string;
  status: "loading" | "in_progress" | "done";
  start_label: string | null;
  start_lat: number | null;
  start_lng: number | null;
  return_to_start: boolean;
  optimized_at: string | null;
}
export interface Stop {
  id: string;
  position: number;
  parcel_code: string | null;
  parcel_count: number;
  address: string;
  lat: number | null;
  lng: number | null;
  recipient: string | null;
  phone: string | null;
  notes: string | null;
  status: "pending" | "delivered" | "failed";
}
export interface RunResume {
  id: string;
  name: string | null;
  run_date: string;
  status: Run["status"];
  nbArrets: number;
  nbColis: number;
  nbRestants: number;
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: init?.body ? { "Content-Type": "application/json" } : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur réseau");
  return json as T;
}

export const waze = (s: Stop) => (s.lat !== null ? `https://waze.com/ul?ll=${s.lat},${s.lng}&navigate=yes` : `https://waze.com/ul?q=${encodeURIComponent(s.address)}&navigate=yes`);
export const gmaps = (s: Stop) =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(s.lat !== null ? `${s.lat},${s.lng}` : s.address)}&travelmode=driving`;

/** Message du SMS « j'arrive » proposé au chauffeur. */
export const SMS_ARRIVEE = "Bonjour, je suis votre livreur : j'arrive chez vous dans quelques minutes avec votre colis.";
