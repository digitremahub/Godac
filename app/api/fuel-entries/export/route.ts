import { NextResponse } from "next/server";
import { garderApi } from "@/lib/acces/garde-api";
import { journaliser } from "@/lib/audit/journal";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { fetchAllRows } from "@/lib/utils/fetch-all";
import { nextDay, parisDay, parisMidnightIso } from "@/lib/utils/paris-time";
import {
  EXPORT_MAX_PLEINS,
  FORMATS_EXPORT_PLEINS,
  ROLES_EXPORT_PLEINS,
  avertissementTroncature,
  csvPleins,
  lignePleinExport,
  lireFiltresExportPleins,
  nomFichierPleins,
  perimetreExportPleins,
  statutsDuFiltre,
  type FormatExportPleins,
  type PleinBrut,
} from "@/lib/fuel/export";

export const dynamic = "force-dynamic";

const COLONNES = "id, occurred_at, liters, unit_price, total_amount, vehicle_km, product, status, station_name, tank_id, ticket_photo_path, vehicles(registration), users!fuel_entries_driver_id_fkey(full_name), tanks(name)";

const un = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * Export comptable des pleins (CSV pour Excel France ou classeur Excel), avec
 * filtres période / véhicule / chauffeur / statut et totaux (litres, HT, TTC,
 * TVA). Comptable, direction et exploitation : toute l'organisation ; manager :
 * son service (la RLS de fuel_entries borne la lecture, le périmètre du rôle est
 * revérifié ici) ; chauffeur : refusé. Borné en volume, annonce la troncature
 * (ligne dans le fichier et en-tête X-Export-Tronque), journalisé (nombres et
 * filtres, aucune donnée personnelle).
 */
export async function GET(req: Request) {
  const g = await garderApi({ roles: ROLES_EXPORT_PLEINS });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const perimetre = perimetreExportPleins(appUser.role);
  if (!perimetre) return NextResponse.json({ error: "Export non disponible pour votre rôle." }, { status: 403 });

  const p = Object.fromEntries(new URL(req.url).searchParams.entries());
  const format = (p.format ?? "csv") as FormatExportPleins;
  if (!FORMATS_EXPORT_PLEINS.includes(format)) return NextResponse.json({ error: "Format inconnu (csv ou xlsx)." }, { status: 400 });
  const filtres = lireFiltresExportPleins(p, parisDay());
  const statuts = statutsDuFiltre(filtres.statut);

  try {
    const lire = (colonnes: string) =>
      fetchAllRows<Record<string, unknown>>(
        (a, b) => {
          let q = supabase
            .from("fuel_entries")
            .select(colonnes)
            .eq("organization_id", appUser.organization_id)
            .gte("occurred_at", parisMidnightIso(filtres.du))
            .lt("occurred_at", parisMidnightIso(nextDay(filtres.au)));
          if (filtres.vehicule) q = q.eq("vehicle_id", filtres.vehicule);
          if (filtres.chauffeur) q = q.eq("driver_id", filtres.chauffeur);
          if (statuts) q = q.in("status", [...statuts]);
          return q.order("occurred_at", { ascending: true }).order("id", { ascending: true }).range(a, b) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>;
        },
        // Un de plus que le plafond : sa présence révèle la troncature.
        { maxRows: EXPORT_MAX_PLEINS + 1 },
      );
    // ticpe_justificatif : migration 20261031000002 ; sans elle, relecture sans la colonne.
    let lu = await lire(`${COLONNES}, ticpe_justificatif`);
    if (lu.error && estSchemaManquant({ message: lu.error })) lu = await lire(COLONNES);
    if (lu.error) throw new Error(lu.error);

    const tronque = lu.truncated || lu.rows.length > EXPORT_MAX_PLEINS;
    const lignes = lu.rows.slice(0, EXPORT_MAX_PLEINS).map((r) =>
      lignePleinExport({
        ...(r as unknown as PleinBrut),
        vehicule: un<{ registration: string }>(r.vehicles as never)?.registration ?? null,
        chauffeur: un<{ full_name: string }>(r.users as never)?.full_name ?? null,
        cuve: un<{ name: string }>(r.tanks as never)?.name ?? null,
      }),
    );

    await journaliser({
      organizationId: appUser.organization_id,
      userId: appUser.id,
      action: "export_pleins",
      details: { format, perimetre, lignes: lignes.length, tronque, du: filtres.du, au: filtres.au, statut: filtres.statut, filtre_vehicule: Boolean(filtres.vehicule), filtre_chauffeur: Boolean(filtres.chauffeur) },
    });

    const nom = nomFichierPleins(filtres.du, filtres.au, format);
    const entetes: Record<string, string> = { "Content-Disposition": `attachment; filename="${nom}"`, "Cache-Control": "no-store", "X-Export-Tronque": tronque ? "1" : "0" };
    if (tronque) entetes["X-Export-Avertissement"] = encodeURIComponent(avertissementTroncature());
    if (format === "xlsx") {
      const { classeurPleins } = await import("@/lib/fuel/export-excel");
      const { data: org } = await supabase.from("organizations").select("name").eq("id", appUser.organization_id).maybeSingle();
      const buffer = await classeurPleins({ organisation: (org as { name?: string } | null)?.name ?? "", filtres, lignes, tronque });
      return new NextResponse(new Uint8Array(buffer), { headers: { ...entetes, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } });
    }
    return new NextResponse(csvPleins(lignes, { tronque }), { headers: { ...entetes, "Content-Type": "text/csv; charset=utf-8" } });
  } catch (e) {
    console.error("export pleins :", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Export impossible pour le moment." }, { status: 500 });
  }
}
