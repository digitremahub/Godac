import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  label: z.string().min(1),
  salarial_rate: z.coerce.number().min(0).max(100),
  patronal_rate: z.coerce.number().min(0).max(100),
});

/**
 * Direction-only grille de cotisations (voir supabase/migrations/
 * 20260101000094) — mirrors RLS ("payslip_contribution_lines:
 * direction manages"), the role check here just gives a clearer error
 * than a bare RLS rejection.
 */
export async function POST(req: Request) {
  const g = await garderApi({ roles: "tous" });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (appUser.role !== "direction") {
    return NextResponse.json({ error: "Rôle non autorisé pour gérer les cotisations." }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("payslip_contribution_lines")
    .insert({ organization_id: appUser.organization_id, ...parsed.data })
    .select("id, label, salarial_rate, patronal_rate")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ line: data });
}
