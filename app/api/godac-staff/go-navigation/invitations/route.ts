import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { isGodacStaffEmail } from "@/lib/godac-staff/auth";
import { genererJetonInvitation, hacherJetonInvitation } from "@/lib/go-navigation/jeton";
import { expirationInvitation, normaliserNote } from "@/lib/go-navigation/offre";

const bodySchema = z.object({ note: z.string().max(500).optional() });

/**
 * Staff GODAC : génère un lien d'invitation GO Navigation. Seul le hash du
 * jeton est enregistré ; le chemin complet (/go-navigation/<jeton>) n'est
 * renvoyé qu'ici, une seule fois.
 */
export async function POST(req: Request) {
  const userClient = await createServerSupabaseClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!isGodacStaffEmail(user?.email)) {
    return NextResponse.json({ error: "Accès réservé au personnel GODAC" }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Note invalide (500 caractères maximum)." }, { status: 400 });

  const jeton = genererJetonInvitation();
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("go_navigation_invitations")
    .insert({
      token_hash: hacherJetonInvitation(jeton),
      note: normaliserNote(parsed.data.note),
      expires_at: expirationInvitation().toISOString(),
      created_by_email: user!.email!.toLowerCase(),
    })
    .select("id, note, expires_at, created_at")
    .single();
  if (error) {
    console.error("invitation GO Navigation", error.message);
    return NextResponse.json({ error: "Impossible de créer l'invitation (migration 20261023000003 appliquée ?)." }, { status: 500 });
  }
  return NextResponse.json({ invitation: data, chemin: `/go-navigation/${jeton}` });
}
