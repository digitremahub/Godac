import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  label: z.string().min(1).optional(),
  salarial_rate: z.coerce.number().min(0).max(100).optional(),
  patronal_rate: z.coerce.number().min(0).max(100).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
    .update(parsed.data)
    .eq("id", id)
    .select("id, label, salarial_rate, patronal_rate")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ line: data });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g2 = await garderApi({ roles: "tous" });
  if (!g2.ok) return g2.reponse;
  const appUser = g2.appUser;
  if (appUser.role !== "direction") {
    return NextResponse.json({ error: "Rôle non autorisé pour gérer les cotisations." }, { status: 403 });
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("payslip_contribution_lines").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
