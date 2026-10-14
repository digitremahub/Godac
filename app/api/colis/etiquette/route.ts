import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { consommer } from "@/lib/usage/consommer";
import { isModuleEnabled } from "@/lib/organization/modules";
import { moduleActif } from "@/lib/colis/serveur";
import { lireEtiquette } from "@/lib/colis/lecture-ia";

const bodySchema = z.object({
  image: z.string().min(100).max(8_000_000),
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
});

/**
 * Lecture de l'adresse sur la photo d'une étiquette. Soumise, comme les
 * autres lectures automatiques, à l'option « lecture automatique » de
 * l'entreprise ; la photo n'est jamais enregistrée.
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  if (!(await isModuleEnabled(supabase, appUser.organization_id, "ocr"))) {
    return NextResponse.json({ error: "Lecture automatique désactivée pour votre entreprise : scannez le code ou saisissez l'adresse." }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Photo invalide." }, { status: 400 });
  const quota = await consommer(createAdminSupabaseClient(), appUser.organization_id, appUser.id, "ocr_label");
  if (!quota.ok) return NextResponse.json({ error: quota.raison }, { status: 429 });
  const result = await lireEtiquette(parsed.data.image, parsed.data.mediaType);
  if (!result.ok) return NextResponse.json({ error: "Étiquette illisible — saisissez l'adresse." }, { status: 422 });
  return NextResponse.json(result.etiquette);
}
