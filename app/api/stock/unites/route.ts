import { NextResponse } from "next/server";
import { garderApi } from "@/lib/acces/garde-api";
import { LECTEURS_STOCK } from "@/lib/acces/catalogue";
import { traduireErreurStock } from "@/lib/stock/erreurs";
import { reponseErreur } from "@/lib/stock/http";
import { estStatutUnite } from "@/lib/stock/transitions";

const COLONNES = "id, activite, code, type_unite, poids_kg, volume_m3, sscc, statut, site_id, emplacement_id, run_id, stop_id, updated_at";
const PAR_PAGE = 50;

/**
 * Colis et palettes : `?code=` (code exact, pour le scan), sinon `?q=` (code ou SSCC contenant le texte),
 * `?statut=`, `?site=`, `?page=`. La RLS borne un manager à ses dépôts.
 */
export async function GET(req: Request) {
  const g = await garderApi({ roles: LECTEURS_STOCK, modules: ["stock"] });
  if (!g.ok) return g.reponse;
  const { supabase, appUser } = g;
  const url = new URL(req.url);
  const code = (url.searchParams.get("code") ?? "").trim().slice(0, 80);
  let query = supabase.from("stock_unites").select(COLONNES, { count: "exact" }).eq("organization_id", appUser.organization_id);
  if (code) {
    const { data, error } = await query.eq("code", code).maybeSingle();
    if (error) return reponseErreur(traduireErreurStock(error));
    return NextResponse.json({ unite: data ?? null });
  }
  const q = (url.searchParams.get("q") ?? "").trim().replace(/[%_,()*]/g, " ").slice(0, 60);
  const statut = url.searchParams.get("statut");
  const site = url.searchParams.get("site");
  const page = Math.max(1, Math.min(10000, Math.floor(Number(url.searchParams.get("page") ?? "1")) || 1));
  if (q) query = query.or(`code.ilike.%${q}%,sscc.ilike.%${q}%`);
  if (statut && estStatutUnite(statut)) query = query.eq("statut", statut);
  if (site && /^[0-9a-f-]{36}$/i.test(site)) query = query.eq("site_id", site);
  const { data, error, count } = await query.order("updated_at", { ascending: false }).order("id").range((page - 1) * PAR_PAGE, page * PAR_PAGE - 1);
  if (error) return reponseErreur(traduireErreurStock(error));
  return NextResponse.json({ unites: data ?? [], total: count ?? 0, page, parPage: PAR_PAGE });
}
