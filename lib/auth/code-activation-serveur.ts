import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DUREE_ACTIVATION_JOURS, genererCodeActivation, normaliserCodeActivation } from "@/lib/auth/code-activation";

function secret(): string {
  const value = process.env.PIN_PEPPER || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) throw new Error("PIN_PEPPER is not configured");
  return value;
}

export function hacherCodeActivation(userId: string, code: string): string {
  return createHmac("sha256", secret()).update(`activation:${userId}:${normaliserCodeActivation(code)}`).digest("hex");
}

export function codeActivationCorrespond(userId: string, code: string, hache: string): boolean {
  const a = Buffer.from(hacherCodeActivation(userId, code), "hex");
  const b = Buffer.from(hache, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Crée (ou remplace) le code d'activation d'un chauffeur ; renvoie le code en clair, à afficher une seule fois. */
export async function creerCodeActivation(
  admin: SupabaseClient,
  params: { userId: string; organizationId: string; createdBy: string },
): Promise<string> {
  const code = genererCodeActivation();
  const { error } = await admin.from("driver_pin_activations").upsert(
    {
      user_id: params.userId,
      organization_id: params.organizationId,
      code_hash: hacherCodeActivation(params.userId, code),
      expires_at: new Date(Date.now() + DUREE_ACTIVATION_JOURS * 86_400_000).toISOString(),
      failed_count: 0,
      created_by: params.createdBy,
      created_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(`Code d'activation non enregistré : ${error.message}`);
  return code;
}

/** Ferme toutes les sessions ouvertes du compte (RPC service role, migration 20261019000005). */
export async function revoquerSessions(admin: SupabaseClient, userId: string): Promise<void> {
  const { error } = await admin.rpc("revoquer_sessions_utilisateur", { p_user_id: userId });
  if (error) throw new Error(`Révocation des sessions impossible : ${error.message}`);
}
