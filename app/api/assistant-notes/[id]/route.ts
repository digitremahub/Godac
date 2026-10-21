import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  title: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  roles: z.array(z.enum(["chauffeur", "manager", "exploitation", "comptable", "direction"])).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
  const { error } = await supabase.from("assistant_notes").update(parsed.data).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g2 = await garderApi({ roles: ["direction", "manager", "exploitation"] });
  if (!g2.ok) return g2.reponse;
  const appUser = g2.appUser;
  if (appUser.role !== "direction") {
    return NextResponse.json({ error: "Seule la direction peut gérer les consignes." }, { status: 403 });
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("assistant_notes").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
