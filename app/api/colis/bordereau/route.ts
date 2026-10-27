import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { consommer, rembourser } from "@/lib/usage/consommer";
import { journaliserJetons } from "@/lib/usage/jetons";
import { moduleActif, tourneeParId } from "@/lib/colis/serveur";
import { MESSAGE_TOURNEE_CLOTUREE } from "@/lib/colis/cloture";
import { lireBordereau } from "@/lib/ocr/bordereau";
import { normaliserPage } from "@/lib/colis/bordereau";
import { codePays } from "@/lib/pays/serveur";

// Une page dense (10 à 15 blocs, ou 40 lignes) peut demander plusieurs
// minutes de lecture ; lib/ocr/bordereau.ts s'arrête avant (DELAI_LECTURE_MS,
// 270 s) pour répondre un message clair plutôt qu'une coupure de l'hébergeur.
export const maxDuration = 300;

/**
 * Photo en base64 : l'écran la compresse sous 3 millions de caractères
 * (components/colis/commun.ts) ; Vercel refuse tout corps au-delà de 4,5 Mo.
 */
const IMAGE_MAX = 3_500_000;

const bodySchema = z.object({
  run_id: z.string().uuid(),
  image: z.string().min(100).max(IMAGE_MAX),
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
});

/**
 * Lecture d'une page du bordereau de tournée (tout transporteur)
 * photographiée par le chauffeur (lib/ocr/bordereau.ts). Chaque page lue compte comme une
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
  const body = (await req.json().catch(() => null)) as { image?: unknown } | null;
  if (typeof body?.image === "string" && body.image.length > IMAGE_MAX) return NextResponse.json({ error: "Photo trop lourde : reprenez la page." }, { status: 413 });
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Photo invalide : reprenez la page." }, { status: 400 });
  const run = await tourneeParId(supabase, appUser, parsed.data.run_id);
  if (!run) return NextResponse.json({ error: "Tournée introuvable." }, { status: 404 });
  if (run.status === "done") return NextResponse.json({ error: MESSAGE_TOURNEE_CLOTUREE }, { status: 409 });

  const admin = createAdminSupabaseClient();
  const quota = await consommer(admin, appUser.organization_id, appUser.id, "ocr_label");
  if (!quota.ok) return NextResponse.json({ error: quota.raison, code: "QUOTA_ATTEINT" }, { status: 429 });

  const lecture = await lireBordereau(parsed.data.image, parsed.data.mediaType);
  if (!lecture.ok) {
    // Échec de notre côté (service IA, réponse coupée, délai) : la lecture
    // n'est pas comptée. Une photo illisible reste comptée (l'IA l'a lue).
    if (lecture.raison !== "illisible") {
      console.error(`bordereau: lecture impossible (${lecture.raison})`, lecture.detail);
      await rembourser(admin, quota.eventId);
    }
    const message =
      lecture.raison === "illisible"
        ? "Page illisible : reprenez la photo bien à plat, en entier et nette."
        : lecture.raison === "dense"
          ? "Page trop chargée pour une seule photo (réponse coupée) : photographiez le haut de la page, puis le bas. Cette lecture n'est pas comptée."
          : lecture.raison === "delai"
            ? "La lecture a pris trop de temps. Réessayez, ou photographiez la page en deux moitiés (haut, puis bas). Cette lecture n'est pas comptée."
            : "Service de lecture indisponible pour le moment. Réessayez dans un instant. Cette lecture n'est pas comptée.";
    const code = lecture.raison === "illisible" ? "ILLISIBLE" : lecture.raison === "dense" ? "DENSE" : "LECTURE";
    return NextResponse.json({ error: message, code }, { status: lecture.raison === "illisible" || lecture.raison === "dense" ? 422 : 502 });
  }
  // Coût réel de la lecture (modèle plus cher qu'une étiquette) : journalisé, sans changer le décompte facturé.
  await journaliserJetons(admin, quota.eventId, "ocr_bordereau", lecture.jetons);
  return NextResponse.json({ page: normaliserPage(lecture.page, await codePays(appUser.organization_id)) });
}
