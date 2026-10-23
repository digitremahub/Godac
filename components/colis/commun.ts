/** Types et petits utilitaires partagés par la tournée colis et l'application chauffeur. */
import type { FicheHoraires } from "@/lib/colis/horaires";
import type { Arrivee, Depart } from "@/lib/colis/extremites";
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
  /** Départ / arrivée de l'optimisation (épingles 📌 comprises) ; absents avant la migration 20261102000001 ou si jamais choisis. */
  optim_depart?: Depart | null;
  optim_arrivee?: Arrivee | null;
  /** false : colonnes absentes, le choix reste sur l'appareil. */
  optim_persiste?: boolean;
}
export interface Stop {
  id: string;
  position: number;
  parcel_code: string | null;
  parcel_count: number;
  /** Nombre réellement ramassé, renseigné après l’enlèvement. */
  packages_picked_up?: number | null;
  /** Nombre réellement déposé au point relais, y compris zéro. */
  packages_delivered?: number | null;
  /** Ramasse ponctuelle qui ne doit pas devenir une habitude. */
  exceptional_pickup?: boolean;
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
  /** Chemins de 1 à 3 photos de preuve ; proof_photo_path reste la compatibilité historique. */
  proof_photo_paths?: string[] | null;
  /** Livraison (par défaut) ou ramasse ; absent avant la migration 170. */
  kind?: "livraison" | "ramasse" | "point_relais" | null;
  /** Livraison avec QR code : valeur scannée (preuve de remise). */
  proof_code?: string | null;
  /** Point relais : nom du relais (arrêt point relais, ou livraison remise au relais). */
  relay_name?: string | null;
  /** Poids des colis de l'arrêt en kg (null : inconnu) ; absent avant la migration 171. */
  weight_kg?: number | string | null;
  /** Échec : motif choisi par le chauffeur (lib/colis/cloture.ts). */
  failure_reason?: string | null;
  /** Liste de la tournée (null : liste implicite « Liste principale »). */
  list_id?: string | null;
  /** Créneau ponctuel du jour (« 10:00:00 »), prioritaire sur l'annuaire. */
  window_start?: string | null;
  window_end?: string | null;
  /** Professionnel détecté à la saisie (nom de l'entreprise ou du commerce) ; absent avant la migration 190. */
  business_name?: string | null;
  /** Fiche de l'annuaire des adresses pro (horaires d'ouverture), si l'adresse y figure. */
  horaire?: FicheHoraires | null;
}
export interface RunResume {
  id: string;
  name: string | null;
  run_date: string;
  status: Run["status"];
  /** Heure prévue (HH:MM:SS) : distingue plusieurs fiches du même jour. */
  planned_start?: string | null;
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

/** Base64 envoyé pour une page de bordereau : le corps JSON reste loin de la limite de 4,5 Mo de Vercel. */
export const PHOTO_DOCUMENT_MAX_CARACTERES = 3_000_000;

/**
 * Photo d'un document imprimé dense (bordereau de tournée) : plus de
 * définition qu'une étiquette (jusqu'à 2400 px et ~3,6 Mpx, ce que l'IA lit
 * sans réduction), puis qualité JPEG baissée par paliers — et en dernier
 * recours la taille — jusqu'à passer sous PHOTO_DOCUMENT_MAX_CARACTERES.
 * Orientation EXIF respectée ; format illisible : message clair en français.
 */
export async function photoDocumentEnBase64(file: File, maxCaracteres = PHOTO_DOCUMENT_MAX_CARACTERES): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("Format de photo non reconnu : reprenez la page avec l'appareil photo.");
  }
  let scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height), Math.sqrt(3_600_000 / (bitmap.width * bitmap.height)));
  const canvas = document.createElement("canvas");
  try {
    for (let essai = 0; essai < 4; essai++, scale *= 0.8) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d")!;
      // Fond blanc : une capture PNG transparente ne devient pas noire en JPEG.
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const qualite of [0.85, 0.75, 0.65, 0.55]) {
        const b64 = canvas.toDataURL("image/jpeg", qualite).split(",")[1] ?? "";
        if (b64.length <= maxCaracteres) return b64;
      }
    }
  } finally {
    bitmap.close?.();
  }
  throw new Error("Photo trop lourde, même compressée : reprenez la page de plus près.");
}
