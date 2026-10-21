import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { consommer } from "@/lib/usage/consommer";
import { moduleActif, tourneeParId } from "@/lib/colis/serveur";
import { MESSAGE_TOURNEE_CLOTUREE } from "@/lib/colis/cloture";
import { lireBordereau } from "@/lib/ocr/bordereau";
import { normaliserPage } from "@/lib/colis/bordereau";
import { codePays } from "@/lib/pays/serveur";

// Une page dense (10 à 15 blocs) peut demander près d'une minute de lecture.
export const maxDuration = 120;

const bodySchema = z.object({
  run_id: z.string().uuid(),
  image: z.string().min(100).max(8_000_000),
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
});

/**
 * Lecture d'une page du bordereau de tournée DPD photographiée par le
 * chauffeur (lib/ocr/bordereau.ts). Chaque page lue compte comme une
 * lecture d'étiquette (quota « ocr_label ») : un bordereau de 20 pages =
 * 20 lectures. Rien n'est ajouté à la tournée ici : l'écran fusionne les
 * pages, montre l'aperçu, puis envoie les arrêts retenus à
 * /api/colis/arrets/bulk. La photo n'est jamais enregistrée.
 */
export async function POST(req: Request) {
  const g = await garderApi({ modules: ["route_optimizer"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Photo invalide ou trop lourde." }, { status: 400 });
  const run = await tourneeParId(supabase, appUser, parsed.data.run_id);
  if (!run) return NextResponse.json({ error: "Tournée introuvable." }, { status: 404 });
  if (run.status === "done") return NextResponse.json({ error: MESSAGE_TOURNEE_CLOTUREE }, { status: 409 });

  const quota = await consommer(createAdminSupabaseClient(), appUser.organization_id, appUser.id, "ocr_label");
  if (!quota.ok) return NextResponse.json({ error: quota.raison, code: "QUOTA_ATTEINT" }, { status: 429 });

  const lecture = await lireBordereau(parsed.data.image, parsed.data.mediaType);
  if (!lecture.ok) {
    if (lecture.raison !== "illisible") console.error("bordereau: lecture impossible", lecture.detail);
    const message =
      lecture.raison === "illisible"
        ? "Page illisible, reprenez la photo bien à plat."
        : lecture.raison === "delai"
          ? "La lecture a pris trop de temps. Réessayez avec cette page."
          : "Lecture indisponible pour le moment. Réessayez dans un instant.";
    return NextResponse.json({ error: message, code: lecture.raison === "illisible" ? "ILLISIBLE" : "LECTURE" }, { status: lecture.raison === "illisible" ? 422 : 502 });
  }
  return NextResponse.json({ page: normaliserPage(lecture.page, await codePays(appUser.organization_id)) });
}
