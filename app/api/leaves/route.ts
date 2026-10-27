import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { controlerDemande } from "@/lib/leaves/controle";
import { soldesConges } from "@/lib/paie/conges-serveur";
import { parisDay } from "@/lib/utils/paris-time";

const bodySchema = z
  .object({
    service_id: z.string().uuid(),
    start_date: z.string().date(),
    end_date: z.string().date(),
    reason: z.string().optional(),
    /** Demande confirmée malgré un solde insuffisant (congé anticipé ou sans solde). */
    confirmerSoldeInsuffisant: z.boolean().optional(),
  })
  .refine((b) => b.end_date >= b.start_date, { message: "La date de fin doit être après la date de début", path: ["end_date"] });

/**
 * Module 6: a driver requests their own leave. Overlap with a
 * colleague's leave in the same service (lib/business/leave-overlap.ts)
 * is surfaced to the manager at decision time, not blocked here — a
 * small agency may sometimes accept an overlap.
 *
 * Contrôles serveur (lib/leaves/controle.ts), le formulaire n'est qu'une aide :
 * le service doit être l'un des services du demandeur, la demande ne recouvre
 * pas une autre de ses demandes, et un solde insuffisant (solde de reprise
 * renseigné) demande une confirmation explicite.
 */
export async function POST(req: Request) {
  const g = await garderApi({ modules: ["leave_management"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const leaveEnabled = await isModuleEnabled(supabase, appUser.organization_id, "leave_management");
  if (!leaveEnabled) {
    return NextResponse.json({ error: "Module Congés & Absences non activé pour votre organisation" }, { status: 403 });
  }

  const [{ data: liens }, { data: existants }, soldes] = await Promise.all([
    supabase.from("user_services").select("service_id").eq("user_id", appUser.id),
    supabase
      .from("leave_requests")
      .select("id, start_date, end_date, status")
      .eq("driver_id", appUser.id)
      .in("status", ["pending", "approved"])
      .lte("start_date", parsed.data.end_date)
      .gte("end_date", parsed.data.start_date),
    soldesConges(supabase, appUser.organization_id, [appUser.id], parisDay()),
  ]);
  const verdict = controlerDemande({
    du: parsed.data.start_date,
    au: parsed.data.end_date,
    serviceId: parsed.data.service_id,
    servicesDuDemandeur: ((liens ?? []) as { service_id: string }[]).map((l) => l.service_id),
    existants: ((existants ?? []) as { id: string; start_date: string; end_date: string; status: string }[]).map((c) => ({ id: c.id, du: c.start_date, au: c.end_date, status: c.status })),
    solde: soldes.get(appUser.id) ?? null,
    confirmerSoldeInsuffisant: Boolean(parsed.data.confirmerSoldeInsuffisant),
  });
  if (!verdict.ok) return NextResponse.json({ error: verdict.erreur, code: verdict.code }, { status: verdict.status });

  const { data, error } = await supabase
    .from("leave_requests")
    .insert({
      organization_id: appUser.organization_id,
      driver_id: appUser.id,
      service_id: parsed.data.service_id,
      start_date: parsed.data.start_date,
      end_date: parsed.data.end_date,
      reason: parsed.data.reason || null,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ leaveRequest: data });
}
