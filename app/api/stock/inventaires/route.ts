import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { ENCADREMENT, LECTEURS_STOCK } from "@/lib/acces/catalogue";
import { traduireErreurStock } from "@/lib/stock/erreurs";
import { lireCorps, reponseErreur, REQUETE_INVALIDE } from "@/lib/stock/http";

/** Derniers inventaires (la RLS borne un manager à ses dépôts). */
export async function GET() {
  const g = await garderApi({ roles: LECTEURS_STOCK, modules: ["stock"] });
  if (!g.ok) return g.reponse;
  const { supabase, appUser } = g;
  const { data, error } = await supabase
    .from("stock_inventaires")
    .select("id, site_id, zone_id, statut, note, created_at, created_by_nom, validated_at, ecarts_total, site:stock_sites(nom), zone:stock_emplacements(code)")
    .eq("organization_id", appUser.organization_id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return reponseErreur(traduireErreurStock(error));
  return NextResponse.json({ inventaires: data ?? [] });
}

const corps = z.object({
  cle: z.string().min(8).max(100),
  site_id: z.string().uuid(),
  zone_id: z.string().uuid().nullable().optional(),
  note: z.string().trim().max(300).nullable().optional(),
});

/** Ouvre un comptage pour un dépôt ou une zone (manager de ses services, exploitation, direction). */
export async function POST(req: Request) {
  const g = await garderApi({ roles: ENCADREMENT, modules: ["stock"] });
  if (!g.ok) return g.reponse;
  const parsed = corps.safeParse(await lireCorps(req));
  if (!parsed.success) return reponseErreur(REQUETE_INVALIDE);
  const { data, error } = await g.supabase.rpc("stock_creer_inventaire", { p_cle: parsed.data.cle, p_site: parsed.data.site_id, p_zone: parsed.data.zone_id ?? null, p_note: parsed.data.note ?? null });
  if (error) return reponseErreur(traduireErreurStock(error));
  const r = (data ?? {}) as { inventaire_id?: string; doublon?: boolean };
  return NextResponse.json({ ok: true, inventaire_id: r.inventaire_id ?? null, doublon: Boolean(r.doublon) }, { status: r.doublon ? 200 : 201 });
}
