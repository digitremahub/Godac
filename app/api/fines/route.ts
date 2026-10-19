import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { findFineMatchCandidate } from "@/lib/business/fine-match";
import { parisWallTimeToUtcISOString } from "@/lib/planning/dates";

const bodySchema = z.object({
  vehicle_id: z.string().uuid(),
  infraction_date: z.string().date(),
  infraction_time: z.string().regex(/^\d{2}:\d{2}$/),
  amount: z.coerce.number().nonnegative(),
  reference: z.string().nullable().optional(),
  photo_path: z.string().optional(),
});

/**
 * Encadrement (décision client Q2) : direction, et managers sur les
 * véhicules de leur service — la RLS (« fines: manager-like write »)
 * refuse un véhicule hors de leur service. Module « fines » requis. Creates the fine
 * then immediately runs the match (lib/business/fine-match.ts) so the
 * list shows a suggested driver right away, without a separate round
 * trip; still just a suggestion until PATCH .../confirm.
 */
export async function POST(req: Request) {
  const g = await garderApi({ roles: ["direction", "manager", "manager_chauffeur"], modules: ["fines"] });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const infractionAt = parisWallTimeToUtcISOString(parsed.data.infraction_date, parsed.data.infraction_time);
  const candidate = await findFineMatchCandidate(supabase, { vehicleId: parsed.data.vehicle_id, infractionAt });

  const { data, error } = await supabase
    .from("fines")
    .insert({
      organization_id: appUser.organization_id,
      vehicle_id: parsed.data.vehicle_id,
      infraction_at: infractionAt,
      amount: parsed.data.amount,
      reference: parsed.data.reference || null,
      photo_path: parsed.data.photo_path ?? null,
      matched_planning_entry_id: candidate?.planningEntryId ?? null,
      status: "pending_identification",
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ id: data.id, suggestedDriver: candidate ? { name: candidate.driverName, tourNumber: candidate.tourNumber } : null });
}
