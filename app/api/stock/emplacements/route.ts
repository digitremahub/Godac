import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { PARAMETREURS_STOCK } from "@/lib/acces/catalogue";
import { traduireErreurStock } from "@/lib/stock/erreurs";
import { lireCorps, reponseErreur, REQUETE_INVALIDE } from "@/lib/stock/http";
import { TYPES_ZONE } from "@/lib/stock/emplacements";

const corps = z
  .object({
    site_id: z.string().uuid(),
    genre: z.enum(["zone", "emplacement"]),
    parent_id: z.string().uuid().nullable().optional(),
    type_zone: z.enum(TYPES_ZONE).nullable().optional(),
    code: z.string().trim().min(1).max(40),
    libelle: z.string().trim().max(80).nullable().optional(),
  })
  .refine((v) => (v.genre === "zone" ? !v.parent_id : Boolean(v.parent_id)), { message: "Un emplacement se range dans une zone." });

/** Crée une zone (quai, zone, allée…) ou un emplacement rangé dans une zone du même dépôt. */
export async function POST(req: Request) {
  const g = await garderApi({ roles: PARAMETREURS_STOCK, modules: ["stock"] });
  if (!g.ok) return g.reponse;
  const parsed = corps.safeParse(await lireCorps(req));
  if (!parsed.success) return reponseErreur(REQUETE_INVALIDE);
  const { supabase, appUser } = g;
  const d = parsed.data;
  const { data, error } = await supabase
    .from("stock_emplacements")
    .insert({ organization_id: appUser.organization_id, site_id: d.site_id, genre: d.genre, parent_id: d.genre === "zone" ? null : d.parent_id, type_zone: d.genre === "zone" ? (d.type_zone ?? "zone") : null, code: d.code, libelle: d.libelle || null })
    .select("id, site_id, parent_id, genre, type_zone, code, libelle, actif")
    .single();
  if (error) {
    const e = traduireErreurStock(error);
    return reponseErreur(e.code === "stock_doublon" ? { ...e, message: "Ce code existe déjà dans ce dépôt." } : e);
  }
  return NextResponse.json({ emplacement: data }, { status: 201 });
}
