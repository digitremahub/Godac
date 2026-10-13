/**
 * Contrôle des fichiers déposés par le prestataire (facture, compte
 * rendu) : type MIME déclaré, signature réelle du fichier (premiers
 * octets) et taille. Pur, testé.
 */

export const INVOICE_MAX_BYTES = 10 * 1024 * 1024;

export const INVOICE_TYPES = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
} as const;
export type InvoiceMime = keyof typeof INVOICE_TYPES;

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((b, i) => bytes[i] === b);
}

/** Type détecté à partir des premiers octets, ou null. */
export function sniffInvoiceType(head: Uint8Array): InvoiceMime | null {
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  return null;
}

export type InvoiceCheck = { ok: true; mime: InvoiceMime; extension: string } | { ok: false; error: string };

export function validateInvoiceFile({ declaredType, size, head }: { declaredType: string; size: number; head: Uint8Array }): InvoiceCheck {
  if (size <= 0) return { ok: false, error: "Fichier vide." };
  if (size > INVOICE_MAX_BYTES) return { ok: false, error: "Fichier trop volumineux (10 Mo maximum)." };
  if (!(declaredType in INVOICE_TYPES)) return { ok: false, error: "Format non accepté : PDF, JPEG ou PNG uniquement." };
  const sniffed = sniffInvoiceType(head);
  if (!sniffed || sniffed !== declaredType) return { ok: false, error: "Le contenu du fichier ne correspond pas à son format." };
  return { ok: true, mime: sniffed, extension: INVOICE_TYPES[sniffed] };
}

/** Chemin de stockage, toujours préfixé par l'organisation (isolation par dossier). */
export function invoiceStoragePath(organizationId: string, requestId: string, fileId: string, extension: string): string {
  return `${organizationId}/${requestId}/${fileId}.${extension}`;
}
