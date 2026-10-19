import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";

const bodySchema = z
  .object({
    service_id: z.string().uuid(),
    start_date: z.string().date(),
    end_date: z.string().date(),
    reason: z.string().optional(),
  })
  .refine((b) => b.end_date >= b.start_date, { message: "La date de fin doit être après la date de début", path: ["end_date"] });

/**
 * Module 6: a driver requests their own leave. Overlap with a
 * colleague's leave in the same service (lib/business/leave-overlap.ts)
 * is surfaced to the manager at decision time, not blocked here — a
 * small agency may sometimes accept an overlap.
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
