import "server-only";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { ACTION_ACCUSE_INDICATIF, VERSION_MENTION_INDICATIVE } from "@/lib/legal/mention-indicative";

export interface AccuseIndicatif {
  /** Horodatage ISO de l'accusé de lecture. */
  le: string;
  /** Nom de la personne qui l'a donné (peut être vide si le compte a disparu). */
  par: string;
}

/**
 * Accusé de lecture de la mention « documents indicatifs » pour une
 * organisation : le plus récent des accusés tracés au journal d'audit pour la
 * version courante du texte. Lecture avec la clé serveur (le journal n'est
 * lisible que par la direction côté base ; le comptable doit pouvoir voir
 * que l'accusé existe) et limitée à l'organisation passée en argument.
 * Aucune donnée n'est créée : tout repose sur la table audit_log existante.
 * Retourne null s'il n'y en a pas, ou si la lecture échoue (la case reste alors proposée).
 */
export async function lireAccuseIndicatif(organizationId: string): Promise<AccuseIndicatif | null> {
  try {
    const admin = createAdminSupabaseClient();
    const { data, error } = await admin
      .from("audit_log")
      .select("created_at, details, user_id")
      .eq("organization_id", organizationId)
      .eq("action", ACTION_ACCUSE_INDICATIF)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error || !data) return null;
    const ligne = data.find((l) => (l.details as { version?: string } | null)?.version === VERSION_MENTION_INDICATIVE);
    if (!ligne) return null;
    const par = (ligne.details as { nom?: string } | null)?.nom ?? "";
    return { le: ligne.created_at as string, par };
  } catch {
    return null;
  }
}
