import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { consommer, rembourser } from "@/lib/usage/consommer";
import { isModuleEnabled } from "@/lib/organization/modules";
import { estEncadrement } from "@/lib/roles/perimetre";
import { lireAvisArret } from "@/lib/ocr/avis-arret";
import { BUCKET_ARRETS } from "@/lib/arrets/serveur";

const bodySchema = z.object({ path: z.string().min(1).max(300) });

/**
 * Lecture automatique d'un avis d'arrêt déjà déposé (work-stoppage-docs),
 * pour pré-remplir la déclaration : dates, type, prolongation. Le
 * salarié confirme. Module « ocr » coupé : pas de lecture, saisie à la
 * main. Photo du volet médical : supprimée aussitôt, à reprendre.
 */
export async function POST(req: Request) {
  const g = await garderApi({ roles: "tous" });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Photo manquante." }, { status: 400 });
  const chemin = parsed.data.path;
  const autorise =
    !chemin.includes("..") &&
    (chemin.startsWith(`${appUser.organization_id}/${appUser.id}/`) || ((estEncadrement(appUser.role) || appUser.role === "comptable") && chemin.startsWith(`${appUser.organization_id}/`)));
  if (!autorise) return NextResponse.json({ error: "Chemin de photo invalide." }, { status: 403 });

  if (!(await isModuleEnabled(supabase, appUser.organization_id, "ocr"))) {
    return NextResponse.json({ champs: null, info: "Lecture automatique non activée : complétez les dates à la main." });
  }

  // Lecture avec le client de l'utilisateur : la RLS du stockage s'applique.
  const { data: fichier, error } = await supabase.storage.from(BUCKET_ARRETS).download(chemin);
  if (error || !fichier) return NextResponse.json({ champs: null, info: "Photo introuvable : complétez les dates à la main." });

  const admin = createAdminSupabaseClient();
  const quota = await consommer(admin, appUser.organization_id, appUser.id, "ocr_arret");
  if (!quota.ok) return NextResponse.json({ champs: null, info: quota.raison });

  const r = await lireAvisArret(Buffer.from(await fichier.arrayBuffer()), chemin);
  if (!r.ok) {
    await rembourser(admin, quota.eventId);
    return NextResponse.json({ champs: null, info: `${r.raison} Complétez les dates à la main.` });
  }
  if (r.champs.volet_medical) {
    // Aucune donnée médicale conservée : la photo est retirée.
    const { error: e } = await admin.storage.from(BUCKET_ARRETS).remove([chemin]);
    if (e) console.error("arrêts : photo du volet médical non supprimée", e.message);
    return NextResponse.json({
      champs: null,
      voletMedical: true,
      error: "Cette photo semble montrer le volet médical (volet 1). Elle a été supprimée : photographiez uniquement le volet destiné à l'employeur.",
    });
  }
  if (!r.champs.lisible) return NextResponse.json({ champs: null, info: "Avis illisible : complétez les dates à la main (la photo reste jointe)." });
  return NextResponse.json({ champs: { type: r.champs.type, du: r.champs.du, au: r.champs.au, prolongation: r.champs.prolongation } });
}
