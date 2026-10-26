import "server-only";
import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { idActionHorsLigne, tableAbsente } from "@/lib/offline/idempotence";

/**
 * Rend une route rejouable sans effet double : une action de la file hors
 * ligne (en-tête X-GODAC-Offline-Action) déjà traitée reçoit un succès
 * « duplicate » au lieu d'être exécutée une seconde fois (compteur de colis
 * incrémenté deux fois, tournée créée en double…).
 *
 * L'identifiant est réservé dans `offline_actions` avant l'exécution et
 * libéré si la route échoue, pour que le rejeu suivant puisse aboutir.
 * Sans l'en-tête, ou tant que la migration n'est pas appliquée, la route
 * s'exécute normalement.
 */
export async function avecIdempotence(req: Request, organizationId: string, executer: () => Promise<Response>): Promise<Response> {
  const id = idActionHorsLigne(req.headers);
  if (!id) return executer();
  const admin = createAdminSupabaseClient();
  const { error } = await admin.from("offline_actions").insert({ id, organization_id: organizationId });
  if (error) {
    if (error.code === "23505") return NextResponse.json({ ok: true, duplicate: true, message: "Action déjà enregistrée." });
    if (!tableAbsente(error)) console.warn("Idempotence hors ligne indisponible :", error.message);
    return executer();
  }
  let reponse: Response;
  try {
    reponse = await executer();
  } catch (e) {
    await liberer(id);
    throw e;
  }
  if (!reponse.ok) await liberer(id);
  return reponse;
}

async function liberer(id: string) {
  await createAdminSupabaseClient().from("offline_actions").delete().eq("id", id).then(() => undefined, () => undefined);
}
