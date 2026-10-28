import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { LECTEURS_STOCK, PARAMETREURS_STOCK } from "@/lib/acces/catalogue";
import { traduireErreurStock } from "@/lib/stock/erreurs";
import { lireCorps, reponseErreur, REQUETE_INVALIDE } from "@/lib/stock/http";

/** Dépôts avec leurs zones et emplacements (la RLS borne un manager à ses services). */
export async function GET() {
  const g = await garderApi({ roles: LECTEURS_STOCK, modules: ["stock"] });
  if (!g.ok) return g.reponse;
  const { supabase, appUser } = g;
  const [sites, emplacements] = await Promise.all([
    supabase.from("stock_sites").select("id, nom, adresse, service_id, actif").eq("organization_id", appUser.organization_id).order("nom"),
    supabase.from("stock_emplacements").select("id, site_id, parent_id, genre, type_zone, code, libelle, actif").eq("organization_id", appUser.organization_id).order("code"),
  ]);
  const erreur = sites.error ?? emplacements.error;
  if (erreur) return reponseErreur(traduireErreurStock(erreur));
  return NextResponse.json({ sites: sites.data ?? [], emplacements: emplacements.data ?? [] });
}

const corps = z.object({
  nom: z.string().trim().min(1).max(80),
  adresse: z.string().trim().max(200).nullable().optional(),
  service_id: z.string().uuid().nullable().optional(),
});

export async function POST(req: Request) {
  const g = await garderApi({ roles: PARAMETREURS_STOCK, modules: ["stock"] });
  if (!g.ok) return g.reponse;
  const parsed = corps.safeParse(await lireCorps(req));
  if (!parsed.success) return reponseErreur(REQUETE_INVALIDE);
  const { supabase, appUser } = g;
  const { data, error } = await supabase
    .from("stock_sites")
    .insert({ organization_id: appUser.organization_id, nom: parsed.data.nom, adresse: parsed.data.adresse || null, service_id: parsed.data.service_id ?? null })
    .select("id, nom, adresse, service_id, actif")
    .single();
  if (error) {
    const e = traduireErreurStock(error);
    return reponseErreur(e.code === "stock_doublon" ? { ...e, message: "Un dépôt porte déjà ce nom." } : e);
  }
  return NextResponse.json({ site: data }, { status: 201 });
}
