import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { lieuSaisieSchema } from "@/lib/go-lieux/lieux";
import { effacerHistorique, enregistrerFavori, enregistrerRecent, listerLieux } from "@/lib/go-lieux/serveur";

export const dynamic = "force-dynamic";

/**
 * Lieux enregistrés de « Go! » (favoris, récents) de l'utilisateur
 * connecté. Même accès que « Ma tournée colis » (personnes qui conduisent,
 * module Tournée colis, essai en cours). La RLS limite chaque requête aux
 * lignes de l'utilisateur ; table absente : listes vides, l'écran fonctionne.
 */
export async function GET() {
  const g = await garderApi({ ecran: "moi.tournee_colis" });
  if (!g.ok) return g.reponse;
  return NextResponse.json(await listerLieux(g.supabase, g.appUser.id));
}

const corpsSchema = lieuSaisieSchema.extend({
  genre: z.enum(["favori", "recent"]),
  type_lieu: z.enum(["domicile", "travail"]).nullable().optional(),
});

export async function POST(req: Request) {
  const g = await garderApi({ ecran: "moi.tournee_colis" });
  if (!g.ok) return g.reponse;
  const parsed = corpsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Lieu invalide." }, { status: 400 });
  const { genre, type_lieu, ...lieu } = parsed.data;
  if (genre === "recent" && type_lieu) return NextResponse.json({ error: "Lieu invalide." }, { status: 400 });
  const r = genre === "recent" ? await enregistrerRecent(g.supabase, g.appUser.id, g.appUser.organization_id, lieu) : await enregistrerFavori(g.supabase, g.appUser.id, g.appUser.organization_id, lieu, type_lieu ?? null);
  return r.ok ? NextResponse.json({ lieu: r.valeur }) : NextResponse.json({ error: r.message }, { status: r.statut });
}

/** « Tout effacer l'historique » : ?genre=recent (les favoris ne s'effacent pas en bloc). */
export async function DELETE(req: Request) {
  const g = await garderApi({ ecran: "moi.tournee_colis" });
  if (!g.ok) return g.reponse;
  if (new URL(req.url).searchParams.get("genre") !== "recent") return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const r = await effacerHistorique(g.supabase, g.appUser.id);
  return r.ok ? NextResponse.json({ supprimes: r.valeur }) : NextResponse.json({ error: r.message }, { status: r.statut });
}
