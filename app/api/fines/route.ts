import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { findFineMatchCandidate } from "@/lib/business/fine-match";

const bodySchema = z.object({
  vehicle_id: z.string().uuid(),
  infraction_date: z.string().date(),
  infraction_time: z.string().regex(/^\d{2}:\d{2}$/),
  amount: z.coerce.number().nonnegative(),
  reference: z.string().nullable().optional(),
  photo_path: z.string().optional(),
});

/**
 * Direction-only, like /payroll — attributing a fine to a specific
 * employee is HR-sensitive, same class of decision. Creates the fine
 * then immediately runs the match (lib/business/fine-match.ts) so the
 * list shows a suggested driver right away, without a separate round
 * trip; still just a suggestion until PATCH .../confirm.
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  if (appUser.role !== "direction") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const infractionAt = new Date(`${parsed.data.infraction_date}T${parsed.data.infraction_time}:00`).toISOString();
  const supabase = await createServerSupabaseClient();

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
