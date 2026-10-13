import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { assignDriverCodeFromBirthDate } from "@/lib/users/driver-code-serveur";
import { dateNaissanceValide } from "@/lib/users/date-naissance";

const bodySchema = z.object({ birth_date: z.string() });

/**
 * Le salarié renseigne lui-même sa date de naissance (une seule fois),
 * ce qui lui donne son code de secours « initiales + mois/année »
 * (ex : FT1188). Une correction ultérieure passe par la direction
 * (dossier RH), pour qu'on ne change pas son code à volonté.
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success || !dateNaissanceValide(parsed.data.birth_date)) {
    return NextResponse.json({ error: "Date de naissance invalide." }, { status: 400 });
  }

  // employee_files n'est modifiable que par la direction (RLS) : écriture
  // serveur limitée à la propre fiche de l'utilisateur.
  const admin = createAdminSupabaseClient();
  const { data: fiche } = await admin
    .from("employee_files")
    .select("id, birth_date")
    .eq("user_id", appUser.id)
    .eq("organization_id", appUser.organization_id)
    .maybeSingle();
  if (fiche?.birth_date) {
    return NextResponse.json({ error: "Date de naissance déjà renseignée : demandez une correction à la direction." }, { status: 409 });
  }
  const { error } = fiche
    ? await admin.from("employee_files").update({ birth_date: parsed.data.birth_date }).eq("id", fiche.id)
    : await admin
        .from("employee_files")
        .insert({ organization_id: appUser.organization_id, user_id: appUser.id, birth_date: parsed.data.birth_date });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const code = await assignDriverCodeFromBirthDate(admin, appUser.organization_id, appUser.id, appUser.full_name, parsed.data.birth_date);
  return NextResponse.json({ code });
}
