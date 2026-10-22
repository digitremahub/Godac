import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { journaliser } from "@/lib/audit/journal";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { CATEGORIES_TICPE, ZONES_TICPE } from "@/lib/ticpe/bareme";

const schema = z
  .object({
    categorie: z.enum(CATEGORIES_TICPE),
    zone: z.enum(ZONES_TICPE),
    date_debut: z.string().date(),
    date_fin: z.string().date().nullable(),
    taux_eur_hl: z.number().min(0).max(1000),
    motif: z.string().trim().min(3, "Indiquez le motif (au moins 3 caractères).").max(500),
  })
  .refine((s) => !s.date_fin || s.date_fin >= s.date_debut, { message: "La fin précède le début.", path: ["date_fin"] });

/**
 * Taux particulier d'une organisation (surcharge du barème GODAC) —
 * direction ou comptable, avec un motif. Tracé (auteur, date, journal
 * d'audit) ; jamais supprimé, seulement révoqué (./[id]).
 */
export async function POST(req: Request) {
  const g = await garderApi({ ecran: "carburant.ticpe_reglages" });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Taux invalide." }, { status: 400 });

  const { data, error } = await supabase
    .from("ticpe_rate_overrides")
    .insert({ organization_id: appUser.organization_id, ...parsed.data, created_by: appUser.id })
    .select("id")
    .single();
  if (error) {
    if (estSchemaManquant(error)) return NextResponse.json({ error: "Indisponible : la migration 20261031000001 n'est pas encore appliquée." }, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await journaliser({ organizationId: appUser.organization_id, userId: appUser.id, action: "ticpe_surcharge_ajoutee", targetTable: "ticpe_rate_overrides", targetId: data.id, details: parsed.data });
  return NextResponse.json({ ok: true, id: data.id });
}
