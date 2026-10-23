import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { ENCADREMENT } from "@/lib/acces/catalogue";
import { journaliser } from "@/lib/audit/journal";
import { avantApres, aucunChangement } from "@/lib/audit/avant-apres";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";

const jour = z.string().date().nullable();
const schema = z
  .object({
    ticpe_categorie: z.enum(["trm", "trv", "taxi", "exclu"]).nullable(),
    pays_immatriculation: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, "Code pays sur deux lettres (FR, ES, DE…).")
      .nullable(),
    ticpe_location_demandeur: z.enum(["nous", "loueur"]).nullable(),
    flotte_entree_le: jour,
    flotte_sortie_le: jour,
  })
  .refine((v) => !v.flotte_entree_le || !v.flotte_sortie_le || v.flotte_sortie_le >= v.flotte_entree_le, {
    message: "La sortie de flotte précède l'entrée.",
    path: ["flotte_sortie_le"],
  });

/** Informations TICPE d'un véhicule (catégorie, pays, location, période dans la flotte). Encadrement ; RLS vehicles en base. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ roles: ENCADREMENT, modules: ["ticpe_export"] });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Saisie invalide." }, { status: 400 });

  // État d'avant (pour le journal avant / après) : lecture sous la RLS de la personne connectée.
  const { data: avant } = await supabase.from("vehicles").select(Object.keys(parsed.data).join(", ")).eq("id", id).maybeSingle();
  const { data, error } = await supabase.from("vehicles").update(parsed.data).eq("id", id).select("id").maybeSingle();
  if (error) {
    if (estSchemaManquant(error)) return NextResponse.json({ error: "Indisponible : la migration 20261031000002 n'est pas encore appliquée." }, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Véhicule introuvable ou hors de votre périmètre." }, { status: 404 });
  const diff = avantApres(avant as unknown as Record<string, unknown> | null, parsed.data);
  if (!aucunChangement(diff)) {
    await journaliser({ organizationId: appUser.organization_id, userId: appUser.id, action: "ticpe_vehicule_modifie", targetTable: "vehicles", targetId: id, details: diff });
  }
  return NextResponse.json({ ok: true });
}
