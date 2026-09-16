import { NextResponse } from "next/server";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/** Marks the signed-in user's own read receipt — the "statut lu/non lu". */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appUser = await requireAppUser();

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("announcement_reads")
    .upsert({ announcement_id: id, user_id: appUser.id }, { onConflict: "announcement_id,user_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
