import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  roles: z.array(z.enum(["chauffeur", "manager", "exploitation", "comptable", "direction"])).default([]),
});

/** Direction-only consignes d'entreprise feeding the assistant (Admin > Organisation) — RLS backs the role check. */
export async function POST(req: Request) {
  const g = await garderApi({ roles: ["direction", "manager", "exploitation"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (appUser.role !== "direction") {
    return NextResponse.json({ error: "Seule la direction peut gérer les consignes." }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("assistant_notes")
    .insert({ organization_id: appUser.organization_id, created_by: appUser.id, ...parsed.data })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ note: data });
}
