/** Types et petits utilitaires partagés par la tournée colis et l'application chauffeur. */
import type { FicheHoraires } from "@/lib/colis/horaires";
export type { Liste } from "@/lib/colis/listes";
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
  /** Heure de départ prévue (« 08:00:00 ») ; null = 08:00. */
  planned_start?: string | null;
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
  done_at?: string | null;
  delivered_place: string | null;
  proof_photo_path: string | null;
  /** Livraison (par défaut) ou ramasse ; absent avant la migration 170. */
  kind?: "livraison" | "ramasse" | null;
  /** Livraison avec QR code : valeur scannée (preuve de remise). */
  proof_code?: string | null;
  /** Poids des colis de l'arrêt en kg (null : inconnu) ; absent avant la migration 171. */
  weight_kg?: number | string | null;
  /** Échec : motif choisi par le chauffeur (lib/colis/cloture.ts). */
  failure_reason?: string | null;
  /** Liste de la tournée (null : liste implicite « Liste principale »). */
  list_id?: string | null;
  /** Créneau ponctuel du jour (« 10:00:00 »), prioritaire sur l'annuaire. */
  window_start?: string | null;
  window_end?: string | null;
  /** Fiche de l'annuaire des adresses pro (horaires d'ouverture), si l'adresse y figure. */
  horaire?: FicheHoraires | null;
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

/** Photo réduite à 1600 px en JPEG avant envoi (plus rapide, moins de données mobiles). */
export async function imageEnBase64(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85).split(",")[1]!;
}
