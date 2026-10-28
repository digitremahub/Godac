import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { PARAMETREURS_STOCK } from "@/lib/acces/catalogue";
import { journaliser } from "@/lib/audit/journal";
import { traduireErreurStock } from "@/lib/stock/erreurs";
import { lireCorps, reponseErreur, REQUETE_INVALIDE } from "@/lib/stock/http";
import { TYPES_ZONE } from "@/lib/stock/emplacements";

const corps = z
  .object({
    code: z.string().trim().min(1).max(40).optional(),
    libelle: z.string().trim().max(80).nullable().optional(),
    type_zone: z.enum(TYPES_ZONE).nullable().optional(),
    /** Suppression logique : false désactive la zone ou l'emplacement (rien n'est effacé, le stock présent reste visible). */
    actif: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0);

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await garderApi({ roles: PARAMETREURS_STOCK, modules: ["stock"] });
  if (!g.ok) return g.reponse;
  const { id } = await params;
  const parsed = corps.safeParse(await lireCorps(req));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) return reponseErreur(REQUETE_INVALIDE);
  const { supabase, appUser } = g;
  const { data, error } = await supabase
    .from("stock_emplacements")
    .update(parsed.data)
    .eq("id", id)
    .eq("organization_id", appUser.organization_id)
    .select("id, site_id, parent_id, genre, type_zone, code, libelle, actif")
    .maybeSingle();
  if (error) return reponseErreur(traduireErreurStock(error));
  if (!data) return reponseErreur({ code: "stock_emplacement_invalide", message: "Emplacement introuvable.", status: 404 });
  if (parsed.data.actif !== undefined) {
    await journaliser({ organizationId: appUser.organization_id, userId: appUser.id, action: "stock_archivage", targetTable: "stock_emplacements", targetId: id, details: { objet: data.genre, code: data.code, actif: parsed.data.actif } });
  }
  return NextResponse.json({ emplacement: data });
}
