import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  report_bl_number: z.string().nullable().optional(),
  report_stops_total: z.number().int().min(0).nullable().optional(),
  report_packages_count: z.number().int().min(0).nullable().optional(),
  report_priority_count: z.number().int().min(0).nullable().optional(),
  report_stops_delivered: z.number().int().min(0).nullable().optional(),
  report_packages_missing: z.number().int().min(0).nullable().optional(),
  report_pickups: z.number().int().min(0).nullable().optional(),
  report_packages_picked_up: z.number().int().min(0).nullable().optional(),
  report_packages_returned: z.number().int().min(0).nullable().optional(),
  report_packages_relay: z.number().int().min(0).nullable().optional(),
});

/**
 * Lets direction fill in whatever the OCR pass (lib/ocr/tour-report.ts)
 * missed or misread — /reports only ever displayed report_* fields
 * read-only until now, with no way to correct a "—" without re-taking
 * the photo. Scoped to direction only (not manager-like) since this
 * edits numbers that feed TICPE export and fuel-profitability
 * reporting elsewhere; RLS ("planning: manager-like writes scoped to
 * service") already lets direction write any planning_entries row, so
 * the role check here is the only gate needed.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appUser = await requireAppUser();
  if (appUser.role !== "direction") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("planning_entries").update(parsed.data).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
