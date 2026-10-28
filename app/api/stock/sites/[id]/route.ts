import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { PARAMETREURS_STOCK } from "@/lib/acces/catalogue";
import { journaliser } from "@/lib/audit/journal";
import { traduireErreurStock } from "@/lib/stock/erreurs";
import { lireCorps, reponseErreur, REQUETE_INVALIDE } from "@/lib/stock/http";

const corps = z
  .object({
    nom: z.string().trim().min(1).max(80).optional(),
    adresse: z.string().trim().max(200).nullable().optional(),
    service_id: z.string().uuid().nullable().optional(),
    /** Suppression logique : false désactive le dépôt (rien n'est effacé). */
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
    .from("stock_sites")
    .update(parsed.data)
    .eq("id", id)
    .eq("organization_id", appUser.organization_id)
    .select("id, nom, adresse, service_id, actif")
    .maybeSingle();
  if (error) return reponseErreur(traduireErreurStock(error));
  if (!data) return reponseErreur({ code: "stock_site_invalide", message: "Dépôt introuvable.", status: 404 });
  if (parsed.data.actif !== undefined) {
    await journaliser({ organizationId: appUser.organization_id, userId: appUser.id, action: "stock_archivage", targetTable: "stock_sites", targetId: id, details: { objet: "depot", nom: data.nom, actif: parsed.data.actif } });
  }
  return NextResponse.json({ site: data });
}
