import { NextResponse } from "next/server";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { extractTourReportFromImage, type TourReportFields } from "@/lib/ocr/tour-report";
import { arretsLivraison } from "@/lib/ocr/arrets";

/**
 * Relit les scans déjà enregistrés d'une tournée (écran de départ,
 * feuille de début, compte-rendu de retour) avec les règles de lecture
 * actuelles — stops du scan − ramasses, colis REMIS = stops livrés — et
 * remplace les chiffres du rapport par cette nouvelle lecture. Réservé à
 * la direction, comme la correction manuelle (app/api/reports/[id]).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appUser = await requireAppUser();
  if (appUser.role !== "direction") return NextResponse.json({ error: "Non autorisé" }, { status: 403 });

  const supabase = await createServerSupabaseClient();
  if (!(await isModuleEnabled(supabase, appUser.organization_id, "ocr"))) {
    return NextResponse.json({ error: "Lecture automatique désactivée pour votre entreprise." }, { status: 409 });
  }
  const { data: tour, error } = await supabase
    .from("planning_entries")
    .select("id, start_photo_path, start_sheet_path, end_photo_path, report_ocr_raw")
    .eq("id", id)
    .eq("organization_id", appUser.organization_id)
    .single();
  if (error || !tour) return NextResponse.json({ error: "Tournée introuvable." }, { status: 404 });

  const etapes = [
    ["start", tour.start_photo_path],
    ["start_sheet", tour.start_sheet_path],
    ["end", tour.end_photo_path],
  ] as const;
  const lectures: Partial<Record<(typeof etapes)[number][0], TourReportFields>> = {};
  const echecs: string[] = [];
  await Promise.all(
    etapes.map(async ([etape, chemin]) => {
      if (!chemin) return;
      const { data: fichier } = await supabase.storage.from("tour-photos").download(chemin);
      if (!fichier) return void echecs.push(etape);
      const r = await extractTourReportFromImage(Buffer.from(await fichier.arrayBuffer()), chemin);
      if (r.ok) lectures[etape] = r.fields;
      else echecs.push(etape);
    }),
  );
  if (!Object.keys(lectures).length) {
    return NextResponse.json({ error: "Aucun scan n'a pu être relu." }, { status: 422 });
  }

  // Départ : écran du terminal, complété par la feuille de début.
  const depart = lectures.start || lectures.start_sheet ? fusion(lectures.start, lectures.start_sheet) : null;
  const retour = lectures.end ?? null;
  const update: Record<string, unknown> = {
    report_ocr_raw: { ...((tour.report_ocr_raw as object) ?? {}), ...lectures, relu_le: new Date().toISOString() },
  };
  const poser = (colonne: string, valeur: unknown) => {
    if (valeur !== null && valeur !== undefined) update[colonne] = valeur;
  };
  poser("report_bl_number", retour?.bl_number ?? depart?.bl_number);
  poser("report_stops_total", arretsLivraison(depart, retour));
  poser("report_packages_count", depart?.packages_count ?? retour?.packages_count);
  poser("report_priority_count", depart?.priority_count ?? retour?.priority_count);
  poser("report_departure_time", depart?.departure_time ?? retour?.departure_time);
  poser("report_stops_delivered", retour?.stops_delivered);
  poser("report_packages_missing", retour?.packages_missing ?? depart?.packages_missing);
  poser("report_pickups", retour?.pickups ?? depart?.pickups);
  poser("report_return_time", retour?.return_time);
  poser("report_packages_picked_up", retour?.packages_picked_up);
  poser("report_packages_returned", retour?.packages_returned);
  poser("report_packages_relay", retour?.packages_relay);

  const { error: majErreur } = await supabase.from("planning_entries").update(update).eq("id", id);
  if (majErreur) return NextResponse.json({ error: majErreur.message }, { status: 500 });
  return NextResponse.json({ ok: true, relus: Object.keys(lectures), echecs });
}

function fusion(a: TourReportFields | undefined, b: TourReportFields | undefined): TourReportFields {
  if (!a) return b!;
  if (!b) return a;
  const out = { ...a } as Record<string, unknown>;
  for (const [k, v] of Object.entries(b)) if (out[k] === null) out[k] = v;
  return out as TourReportFields;
}
