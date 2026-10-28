import { NextResponse } from "next/server";
import { garderApi } from "@/lib/acces/garde-api";
import { LECTEURS_STOCK } from "@/lib/acces/catalogue";
import { traduireErreurStock } from "@/lib/stock/erreurs";
import { reponseErreur } from "@/lib/stock/http";
import { lireParametresStock } from "@/lib/stock/serveur";
import { PAR_PAGE_UNITES, lireFiltresUnites } from "@/lib/stock/unites";
import { completerUnite, requeteUnites, trouverUniteParCode } from "@/lib/stock/unites-serveur";

/**
 * Colis, palettes, échantillons… : `?code=` (le scan résout le code principal ET le code interne
 * complémentaire), sinon `?q=` (code principal ou interne, SSCC, référence client, lot), `?statut=`,
 * `?site=`, `?nature=`, `?temperature=`, `?urgent=1`, `?fragile=1`, `?page=`. La RLS borne un manager à ses dépôts.
 */
export async function GET(req: Request) {
  const g = await garderApi({ roles: LECTEURS_STOCK, modules: ["stock"] });
  if (!g.ok) return g.reponse;
  const { supabase, appUser } = g;
  const url = new URL(req.url);
  const code = (url.searchParams.get("code") ?? "").trim().slice(0, 80);
  if (code) {
    try {
      return NextResponse.json({ unite: await trouverUniteParCode(supabase, appUser.organization_id, code) });
    } catch (e) {
      return reponseErreur(traduireErreurStock({ message: e instanceof Error ? e.message : "" }));
    }
  }
  const f = lireFiltresUnites(Object.fromEntries(url.searchParams.entries()));
  const { codesInstalles } = await lireParametresStock(supabase, appUser.organization_id);
  const { data, error, count } = await requeteUnites(supabase, appUser.organization_id, f, { codesInstalles, compter: true }).range((f.page - 1) * PAR_PAGE_UNITES, f.page * PAR_PAGE_UNITES - 1);
  if (error) return reponseErreur(traduireErreurStock(error));
  return NextResponse.json({ unites: ((data ?? []) as unknown as Record<string, unknown>[]).map(completerUnite), total: count ?? 0, page: f.page, parPage: PAR_PAGE_UNITES });
}
