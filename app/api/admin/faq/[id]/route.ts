import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { isPlatformAdmin } from "@/lib/auth/platform";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

const ROLES = ["chauffeur", "manager", "manager_chauffeur", "comptable", "direction"] as const;

const patchSchema = z.object({
  question: z.string().trim().min(3).max(300).optional(),
  answer: z.string().trim().max(4000).optional(),
  roles: z.array(z.enum(ROLES)).optional(),
  status: z.enum(["suggested", "published", "dismissed"]).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const appUser = await requireAppUser();
  if (!(await isPlatformAdmin(appUser.id))) return NextResponse.json({ error: "Accès réservé" }, { status: 403 });
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const admin = createAdminSupabaseClient();
  if (parsed.data.status === "published") {
    const { data: row } = await admin.from("assistant_faq").select("answer").eq("id", id).single();
    const answer = parsed.data.answer ?? row?.answer ?? "";
    if (!answer.trim()) return NextResponse.json({ error: "Rédigez une réponse avant de publier." }, { status: 400 });
  }
  const { error } = await admin
    .from("assistant_faq")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const appUser = await requireAppUser();
  if (!(await isPlatformAdmin(appUser.id))) return NextResponse.json({ error: "Accès réservé" }, { status: 403 });
  const { id } = await params;
  const { error } = await createAdminSupabaseClient().from("assistant_faq").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
