import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { ENCADREMENT } from "@/lib/acces/catalogue";
import { journaliser } from "@/lib/audit/journal";
import { attributsPourRpc, schemaAttributs } from "@/lib/stock/attributs";
import { LONGUEUR_CODE_MAX, analyserCodeInterne } from "@/lib/stock/codes";
import { traduireErreurStock } from "@/lib/stock/erreurs";
import { lireCorps, reponseErreur, REQUETE_INVALIDE } from "@/lib/stock/http";

const corps = z
  .object({
    attributs: schemaAttributs.optional(),
    /** Code interne complémentaire à rattacher (généré au préalable) ; le code principal ne change jamais. */
    code_interne: z.string().max(LONGUEUR_CODE_MAX).optional(),
  })
  .strict()
  .refine((v) => v.attributs !== undefined || v.code_interne !== undefined, { message: "Rien à modifier." });

/**
 * Modifie les attributs (nature, température, fragile, urgent, consigne, référence client, lot, DLC)
 * ou rattache un code interne à une unité existante. Encadrement (manager dans ses services,
 * exploitation, direction). Passe par la fonction SQL stock_modifier_unite, qui refuse d'effacer un
 * champ obligatoire du profil de l'unité. Journalisé (clés modifiées, jamais les valeurs libres).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await garderApi({ roles: ENCADREMENT, modules: ["stock"] });
  if (!g.ok) return g.reponse;
  const { id } = await params;
  const parsed = corps.safeParse(await lireCorps(req));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) return reponseErreur(REQUETE_INVALIDE);
  if (parsed.data.code_interne !== undefined && !analyserCodeInterne(parsed.data.code_interne.trim())) {
    return reponseErreur({ code: "stock_code_interne_invalide", message: "Ce n'est pas un code interne valide (format PREFIXE-AAAA-NNNNNN).", status: 400 });
  }
  const attributs = attributsPourRpc(parsed.data.attributs);
  const { data, error } = await g.supabase.rpc("stock_modifier_unite", { p_unite: id, p_attributs: attributs, p_code_interne: parsed.data.code_interne?.trim() ?? null });
  if (error) return reponseErreur(traduireErreurStock(error));
  await journaliser({
    organizationId: g.appUser.organization_id,
    userId: g.appUser.id,
    action: "stock_unite_modifiee",
    targetTable: "stock_unites",
    targetId: id,
    details: { champs: attributs ? Object.keys(attributs) : [], code_interne: parsed.data.code_interne !== undefined },
  });
  return NextResponse.json({ ok: true, unite_id: (data as { unite_id?: string } | null)?.unite_id ?? id });
}
