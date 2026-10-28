import { NextResponse } from "next/server";
import { garderApi } from "@/lib/acces/garde-api";
import { LECTEURS_STOCK } from "@/lib/acces/catalogue";
import { journaliser } from "@/lib/audit/journal";
import { EXPORT_MAX_MOUVEMENTS, FORMATS_EXPORT_STOCK, csvMouvements, ligneHistorique, lireFiltresHistorique, nomFichierMouvements, type FormatExportStock, type MouvementBrut } from "@/lib/stock/historique";
import { requeteMouvements } from "@/lib/stock/requetes-serveur";

export const dynamic = "force-dynamic";

/**
 * Export CSV (Excel France) ou classeur Excel de l'historique, mêmes filtres que
 * l'écran. Périmètre du rôle (la RLS borne un manager à ses dépôts), borné en
 * volume avec avertissement de troncature, journalisé (nombres et filtres seulement).
 */
export async function GET(req: Request) {
  const g = await garderApi({ roles: LECTEURS_STOCK, modules: ["stock"] });
  if (!g.ok) return g.reponse;
  const { supabase, appUser } = g;
  const p = Object.fromEntries(new URL(req.url).searchParams.entries());
  const format = (p.format ?? "csv") as FormatExportStock;
  if (!FORMATS_EXPORT_STOCK.includes(format)) return NextResponse.json({ error: "Format inconnu (csv ou xlsx)." }, { status: 400 });
  const filtres = lireFiltresHistorique(p);
  try {
    const { requete } = await requeteMouvements(supabase, appUser.organization_id, filtres);
    const { data, error } = await requete.limit(EXPORT_MAX_MOUVEMENTS + 1);
    if (error) throw new Error(error.message);
    const brut = (data ?? []) as unknown as MouvementBrut[];
    const tronque = brut.length > EXPORT_MAX_MOUVEMENTS;
    const lignes = brut.slice(0, EXPORT_MAX_MOUVEMENTS).map(ligneHistorique);
    await journaliser({
      organizationId: appUser.organization_id,
      userId: appUser.id,
      action: "stock_export",
      details: { format, lignes: lignes.length, tronque, du: filtres.du, au: filtres.au, type: filtres.type, recherche: Boolean(filtres.q) },
    });
    const nom = nomFichierMouvements(filtres.du, filtres.au, format);
    const entetes: Record<string, string> = { "Content-Disposition": `attachment; filename="${nom}"`, "Cache-Control": "no-store", "X-Export-Tronque": tronque ? "1" : "0" };
    if (format === "xlsx") {
      const { classeurMouvements } = await import("@/lib/stock/export-excel");
      const { data: org } = await supabase.from("organizations").select("name").eq("id", appUser.organization_id).maybeSingle();
      const buffer = await classeurMouvements({ organisation: (org as { name?: string } | null)?.name ?? "", filtres, lignes, tronque });
      return new NextResponse(new Uint8Array(buffer), { headers: { ...entetes, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } });
    }
    return new NextResponse(csvMouvements(lignes, { tronque }), { headers: { ...entetes, "Content-Type": "text/csv; charset=utf-8" } });
  } catch (e) {
    console.error("export stock :", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Export impossible pour le moment." }, { status: 500 });
  }
}
