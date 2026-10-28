import { NextResponse } from "next/server";
import { garderApi } from "@/lib/acces/garde-api";
import { LECTEURS_STOCK } from "@/lib/acces/catalogue";
import { journaliser } from "@/lib/audit/journal";
import { libelleEmplacement } from "@/lib/stock/emplacements";
import { chargerReferentiel } from "@/lib/stock/chargement-serveur";
import { lireParametresStock } from "@/lib/stock/serveur";
import { EXPORT_MAX_UNITES, FORMATS_EXPORT_UNITES, csvUnites, lireFiltresUnites, nomFichierUnites, type UniteExport } from "@/lib/stock/unites";
import { completerUnite, requeteUnites } from "@/lib/stock/unites-serveur";

export const dynamic = "force-dynamic";

/**
 * Export CSV (Excel France) ou classeur Excel des unités, mêmes filtres que la liste : code principal,
 * code interne, nature, température, fragile, urgent, consigne, lot, DLC… Périmètre du rôle (la RLS
 * borne un manager à ses dépôts), borné en volume avec avertissement de troncature, journalisé.
 */
export async function GET(req: Request) {
  const g = await garderApi({ roles: LECTEURS_STOCK, modules: ["stock"] });
  if (!g.ok) return g.reponse;
  const { supabase, appUser } = g;
  const p = Object.fromEntries(new URL(req.url).searchParams.entries());
  const format = (p.format ?? "csv") as (typeof FORMATS_EXPORT_UNITES)[number];
  if (!FORMATS_EXPORT_UNITES.includes(format)) return NextResponse.json({ error: "Format inconnu (csv ou xlsx)." }, { status: 400 });
  const filtres = lireFiltresUnites(p);
  try {
    const { codesInstalles } = await lireParametresStock(supabase, appUser.organization_id);
    const [{ data, error }, referentiel] = await Promise.all([
      requeteUnites(supabase, appUser.organization_id, filtres, { codesInstalles }).limit(EXPORT_MAX_UNITES + 1),
      chargerReferentiel(supabase, appUser.organization_id),
    ]);
    if (error) throw new Error(error.message);
    const brut = ((data ?? []) as unknown as Record<string, unknown>[]).map(completerUnite);
    const tronque = brut.length > EXPORT_MAX_UNITES;
    const lignes: UniteExport[] = brut.slice(0, EXPORT_MAX_UNITES).map((u) => {
      const emp = referentiel.emplacements.find((e) => e.id === u.emplacement_id);
      return { ...u, depot: referentiel.sites.find((s) => s.id === u.site_id)?.nom ?? "", emplacement: emp ? libelleEmplacement(emp, referentiel.emplacements) : "" };
    });
    await journaliser({ organizationId: appUser.organization_id, userId: appUser.id, action: "stock_export_unites", details: { format, lignes: lignes.length, tronque, recherche: Boolean(filtres.q), statut: filtres.statut } });
    const nom = nomFichierUnites(format);
    const entetes: Record<string, string> = { "Content-Disposition": `attachment; filename="${nom}"`, "Cache-Control": "no-store", "X-Export-Tronque": tronque ? "1" : "0" };
    if (format === "xlsx") {
      const { classeurUnites } = await import("@/lib/stock/export-excel");
      const { data: org } = await supabase.from("organizations").select("name").eq("id", appUser.organization_id).maybeSingle();
      const buffer = await classeurUnites({ organisation: (org as { name?: string } | null)?.name ?? "", lignes, tronque });
      return new NextResponse(new Uint8Array(buffer), { headers: { ...entetes, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } });
    }
    return new NextResponse(csvUnites(lignes, { tronque }), { headers: { ...entetes, "Content-Type": "text/csv; charset=utf-8" } });
  } catch (e) {
    console.error("export unités stock :", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Export impossible pour le moment." }, { status: 500 });
  }
}
