import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { LECTEURS_STOCK } from "@/lib/acces/catalogue";
import { chargerInventaire } from "@/lib/stock/requetes-serveur";
import { reponseErreur, REQUETE_INVALIDE } from "@/lib/stock/http";

/** Un inventaire : lignes comptées, unités attendues et aperçu des écarts. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await garderApi({ roles: LECTEURS_STOCK, modules: ["stock"] });
  if (!g.ok) return g.reponse;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return reponseErreur(REQUETE_INVALIDE);
  const charge = await chargerInventaire(g.supabase, g.appUser.organization_id, id);
  if (!charge) return reponseErreur({ code: "stock_inventaire_introuvable", message: "Inventaire introuvable.", status: 404 });
  return NextResponse.json(charge);
}
