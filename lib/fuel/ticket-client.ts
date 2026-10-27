import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { fetchGodac } from "@/lib/http/fetch-godac";
import { verifierFichierTicket } from "@/lib/fuel/justificatif";
import { networkErrorMessage } from "@/lib/utils/network-error";

export type ResultatTicket = { ok: true } | { ok: false; message: string };

/**
 * Joint (ou remplace) la photo du ticket d'un plein existant : la route donne
 * le chemin dans le dossier de l'organisation, la photo part dans le stockage,
 * puis la route la rattache après avoir contrôlé l'objet déposé
 * (app/api/fuel-entries/[id]/ticket). Ne lève jamais.
 */
export async function joindreTicket(fuelEntryId: string, fichier: File): Promise<ResultatTicket> {
  const invalide = verifierFichierTicket({ mime: fichier.type, taille: fichier.size });
  if (invalide) return { ok: false, message: invalide };
  const url = `/api/fuel-entries/${fuelEntryId}/ticket`;
  const json = { "Content-Type": "application/json" };
  const init = await fetchGodac<{ storagePath: string; bucket: string }>(url, { method: "POST", headers: json, body: JSON.stringify({ mime: fichier.type, taille: fichier.size }) });
  if (!init.ok) return { ok: false, message: init.refus.message };
  try {
    const { error } = await createBrowserSupabaseClient().storage.from(init.data.bucket).upload(init.data.storagePath, fichier, { contentType: fichier.type, upsert: true });
    if (error) return { ok: false, message: `Envoi de la photo échoué : ${error.message}` };
  } catch (e) {
    return { ok: false, message: networkErrorMessage(e) };
  }
  const fin = await fetchGodac(url, { method: "PATCH", headers: json, body: JSON.stringify({ ticketPhotoPath: init.data.storagePath }) });
  return fin.ok ? { ok: true } : { ok: false, message: fin.refus.message };
}
