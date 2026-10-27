/**
 * Justificatif d'un plein : la photo du ticket (fuel_entries.ticket_photo_path).
 * Posée à la saisie (facultative sur « Saisir le ticket à la main »), ou jointe
 * et remplacée après coup depuis la liste des pleins
 * (app/api/fuel-entries/[id]/ticket). C'est ce qui résout en une action le
 * point bloquant TICPE « sans justificatif » (lib/ticpe/controles.ts).
 *
 * Fichier pur : types d'images, taille, chemin dans le dossier de l'organisation
 * et droits par rôle, testés dans lib/fuel/__tests__/justificatif.test.ts.
 */

/** Types d'images acceptés (photo d'un téléphone ou fichier de la galerie) et extension de stockage. */
export const TYPES_IMAGE_TICKET: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

/** Taille maximale d'une photo de ticket (une photo de téléphone fait 2 à 6 Mo). */
export const TAILLE_MAX_TICKET_OCTETS = 10 * 1024 * 1024;

/** Un chauffeur remplace une photo existante pendant ce délai seulement (après, la correction revient à l'encadrement et au comptable). */
export const JOURS_REMPLACEMENT_CHAUFFEUR = 7;

export function extensionTicket(mime: string | null | undefined): string | null {
  return TYPES_IMAGE_TICKET[(mime ?? "").toLowerCase()] ?? null;
}

/** Message d'erreur si le fichier (type, taille) n'est pas acceptable, sinon null. */
export function verifierFichierTicket(fichier: { mime: string | null | undefined; taille: number | null | undefined }): string | null {
  if (!extensionTicket(fichier.mime)) return "Seules les photos (JPEG, PNG, WebP, HEIC) sont acceptées.";
  const taille = Number(fichier.taille);
  if (!Number.isFinite(taille) || taille <= 0) return "Fichier vide.";
  if (taille > TAILLE_MAX_TICKET_OCTETS) return `Photo trop lourde (${Math.round(TAILLE_MAX_TICKET_OCTETS / 1048576)} Mo au plus).`;
  return null;
}

/** Chemin de stockage d'un nouveau justificatif : <organisation>/<plein>/ticket-<horodatage>.<ext>. */
export function cheminTicket(organizationId: string, pleinId: string, extension: string, horodatage: number = Date.now()): string {
  return `${organizationId}/${pleinId}/ticket-${horodatage}.${extension}`;
}

/** Le chemin est bien dans le dossier de cette organisation et de ce plein, avec un nom de ticket sûr (aucun « .. », aucun sous-dossier). */
export function cheminTicketValide(chemin: string | null | undefined, organizationId: string, pleinId: string): boolean {
  if (!chemin) return false;
  const attendu = `${organizationId}/${pleinId}/`;
  if (!chemin.startsWith(attendu)) return false;
  const nom = chemin.slice(attendu.length);
  return /^ticket(?:-\d{10,15})?\.(?:jpe?g|png|webp|heic|heif)$/i.test(nom);
}

export interface PleinJoignable {
  driver_id: string | null;
  created_by: string | null;
  occurred_at: string;
  ticket_photo_path: string | null;
}

/**
 * Qui peut joindre ou remplacer le justificatif d'un plein : le chauffeur de
 * son propre plein (ou celui qui l'a saisi pour lui), tant qu'il n'y a pas de
 * photo ou dans les 7 jours qui suivent ; l'encadrement (périmètre garanti par
 * la lecture sous RLS du plein) et le comptable, qui corrige un justificatif
 * manquant, sans pour autant valider quoi que ce soit.
 */
export function peutJoindreTicket(params: { role: string; userId: string; plein: PleinJoignable; maintenant?: Date }): boolean {
  const { role, userId, plein } = params;
  if (["manager", "exploitation", "direction", "comptable"].includes(role)) return true;
  if (role !== "chauffeur") return false;
  if (plein.driver_id !== userId && plein.created_by !== userId) return false;
  if (!plein.ticket_photo_path) return true;
  const age = (params.maintenant ?? new Date()).getTime() - Date.parse(plein.occurred_at);
  return age <= JOURS_REMPLACEMENT_CHAUFFEUR * 86_400_000;
}

/** Plein sans justificatif à joindre : saisi (manuel ou validé), sans photo de ticket. */
export function justificatifManquant(plein: { status: string; ticket_photo_path?: string | null }): boolean {
  return (plein.status === "manual" || plein.status === "validated") && !plein.ticket_photo_path;
}
