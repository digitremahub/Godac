import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { parisWallTimeToUtcISOString } from "@/lib/planning/dates";
import { rechercherResponsableAmende } from "@/lib/rattachement/serveur";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";

const cheminPiece = z.string().min(1).max(300);

const bodySchema = z.object({
  vehicle_id: z.string().uuid(),
  infraction_date: z.string().date(),
  infraction_time: z.string().regex(/^\d{2}:\d{2}$/),
  amount: z.coerce.number().nonnegative(),
  reference: z.string().nullable().optional(),
  /** Avis de contravention (photo ou PDF) déjà déposé dans fine-photos : obligatoire. */
  photo_path: cheminPiece.optional(),
  document_paths: z.array(cheminPiece).max(5).optional(),
  location: z.string().trim().max(300).nullable().optional(),
  reduced_amount: z.coerce.number().nonnegative().nullable().optional(),
  payment_deadline: z.string().date().nullable().optional(),
});

/**
 * Encadrement (décision client Q2) : direction, et managers sur les
 * véhicules de leur service — la RLS (« fines: manager-like write »)
 * refuse un véhicule hors de leur service. Module « fines » requis.
 * La photo (ou le PDF) de l'avis est obligatoire. Le rapprochement avec
 * le planning (lib/rattachement) est calculé tout de suite : simple
 * suggestion jusqu'à la validation du responsable (PATCH …/[id]).
 */
export async function POST(req: Request) {
  const g = await garderApi({ roles: ["direction", "manager"], modules: ["fines"] });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  const pieces = [...new Set([...(d.document_paths ?? []), ...(d.photo_path ? [d.photo_path] : [])])];
  if (pieces.length === 0) return NextResponse.json({ error: "Joignez la photo ou le PDF de l'avis de contravention." }, { status: 400 });
  if (pieces.some((p) => !p.startsWith(`${appUser.organization_id}/`))) return NextResponse.json({ error: "Pièce invalide." }, { status: 403 });

  const infractionAt = parisWallTimeToUtcISOString(d.infraction_date, d.infraction_time);
  const recherche = await rechercherResponsableAmende(supabase, appUser.organization_id, { vehicleId: d.vehicle_id, infractionAt });
  const s = recherche.suggestion;

  const base = {
    organization_id: appUser.organization_id,
    vehicle_id: d.vehicle_id,
    infraction_at: infractionAt,
    amount: d.amount,
    reference: d.reference || null,
    photo_path: pieces[0]!,
    matched_planning_entry_id: s?.planningEntryId ?? null,
    status: "pending_identification",
  };
  const complet = {
    ...base,
    document_paths: pieces,
    location: d.location ?? null,
    reduced_amount: d.reduced_amount ?? null,
    payment_deadline: d.payment_deadline ?? null,
    suggested_driver_id: s?.driverId ?? null,
    run_id: s?.runId ?? null,
    match_confidence: recherche.confiance,
    match_details: recherche.details,
    matched_at: new Date().toISOString(),
  };

  let res = await supabase.from("fines").insert(complet).select("id").single();
  // Migration 20261026000003 non appliquée : colonnes historiques seulement.
  if (res.error && estSchemaManquant(res.error)) res = await supabase.from("fines").insert(base).select("id").single();
  if (res.error || !res.data) return NextResponse.json({ error: res.error?.message ?? "Création impossible." }, { status: 500 });

  return NextResponse.json({
    id: res.data.id,
    confiance: recherche.confiance,
    raison: recherche.details.raison,
    suggestedDriver: s ? { name: s.driverName, tourNumber: s.tourNumber } : null,
  });
}
