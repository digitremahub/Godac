import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { ACTIONS_LOT, COMMENTAIRE_LOT_MAX, LOT_MAX, TYPES_LOT, actionPossible, commentaireRequis, commentaireValide, dedoublonner } from "@/lib/a-traiter/lot";
import { traiterLot } from "@/lib/a-traiter/lot-serveur";

const bodySchema = z.object({
  action: z.enum(ACTIONS_LOT),
  /** Commentaire / motif commun (obligatoire pour justifier un écart carburant et refuser un arrêt). */
  commentaire: z.string().trim().max(COMMENTAIRE_LOT_MAX, `Commentaire limité à ${COMMENTAIRE_LOT_MAX} caractères.`).optional(),
  elements: z
    .array(z.object({ type: z.enum(TYPES_LOT), id: z.string().uuid() }))
    .min(1, "Sélectionnez au moins un élément.")
    .max(LOT_MAX, `${LOT_MAX} éléments au plus par traitement groupé.`),
});

/**
 * Traitement groupé de « À traiter aujourd'hui » (exploitation, direction).
 * Chaque élément passe par la route individuelle existante : mêmes
 * contrôles de rôle, de module et de hiérarchie (jamais sa propre demande,
 * sauf direction seule, tracée). Réponse 200 avec un résultat par élément
 * (réussi / refusé avec motif) : un refus n'annule pas les autres.
 */
export async function POST(req: Request) {
  const g = await garderApi({ ecran: "dashboard.a_traiter" });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Données invalides." }, { status: 400 });
  const { action, commentaire } = parsed.data;
  const elements = dedoublonner(parsed.data.elements);

  if (elements.every((e) => !actionPossible(e.type, action))) {
    return NextResponse.json({ error: "Cette action n'est pas disponible en groupe pour les éléments sélectionnés." }, { status: 422 });
  }
  if (commentaireRequis(action, elements.filter((e) => actionPossible(e.type, action)).map((e) => e.type)) && !commentaireValide(commentaire)) {
    return NextResponse.json({ error: "Un commentaire (3 caractères au moins) est obligatoire pour cette action." }, { status: 422 });
  }

  const { resultats, resume } = await traiterLot({ supabase, utilisateur: appUser, action, commentaire: commentaire || null, elements });
  return NextResponse.json({ resultats, resume });
}
