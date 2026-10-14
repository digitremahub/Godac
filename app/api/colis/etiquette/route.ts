import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { consommer } from "@/lib/usage/consommer";
import { moduleActif } from "@/lib/colis/serveur";
import { lireEtiquette } from "@/lib/colis/lecture-ia";
import { codePays } from "@/lib/pays/serveur";

const bodySchema = z.object({
  image: z.string().min(100).max(8_000_000),
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
});

/**
 * Lecture de l'adresse, du téléphone (normalisé selon le pays de
 * l'entreprise) et du poids sur la photo d'une étiquette. Comprise dans le
 * module Tournée colis (indépendante du module OCR des tickets
 * carburant), dans la limite du quota « ocr_label » de la formule ; la
 * photo n'est jamais enregistrée.
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Photo invalide." }, { status: 400 });
  const quota = await consommer(createAdminSupabaseClient(), appUser.organization_id, appUser.id, "ocr_label");
  if (!quota.ok) return NextResponse.json({ error: quota.raison }, { status: 429 });
  const result = await lireEtiquette(parsed.data.image, parsed.data.mediaType, await codePays(appUser.organization_id));
  if (!result.ok) return NextResponse.json({ error: "Étiquette illisible — saisissez l'adresse." }, { status: 422 });
  return NextResponse.json(result.etiquette);
}
