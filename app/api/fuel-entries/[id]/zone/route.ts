import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { ENCADREMENT } from "@/lib/acces/catalogue";
import { journaliser } from "@/lib/audit/journal";
import { avantApres, aucunChangement } from "@/lib/audit/avant-apres";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";

const schema = z.object({
  /** null = non renseignée : zone de la cuve, sinon zone par défaut de l'organisation. */
  ticpe_zone: z.enum(["metropole", "corse"]).nullable(),
  /** Code pays ISO ; null = non renseigné (France). */
  pays_achat: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Code pays à deux lettres (FR, BE, ES…).")
    .nullable(),
});

/**
 * Zone TICPE (Corse / métropole) et pays d'achat d'un plein, saisis par
 * l'encadrement. Le nom de la station ne décide jamais de la zone. Un plein
 * acheté hors de France n'est pas compté. Journalisé (avant / après).
 * RLS de fuel_entries en base.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ roles: ENCADREMENT, modules: ["ticpe_export"] });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Zone ou pays invalide." }, { status: 400 });

  const { data: avant, error: errLecture } = await supabase.from("fuel_entries").select("id, ticpe_zone, pays_achat").eq("id", id).maybeSingle();
  if (errLecture) {
    if (estSchemaManquant(errLecture)) return NextResponse.json({ error: "Indisponible : la migration 20261101000004 n'est pas encore appliquée." }, { status: 503 });
    return NextResponse.json({ error: errLecture.message }, { status: 500 });
  }
  if (!avant) return NextResponse.json({ error: "Plein introuvable ou hors de votre périmètre." }, { status: 404 });

  const { error } = await supabase.from("fuel_entries").update(parsed.data).eq("id", id);
  if (error) {
    if (estSchemaManquant(error)) return NextResponse.json({ error: "Indisponible : la migration 20261101000004 n'est pas encore appliquée." }, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const diff = avantApres(avant, parsed.data);
  if (!aucunChangement(diff)) {
    await journaliser({ organizationId: appUser.organization_id, userId: appUser.id, action: "plein_modification", targetTable: "fuel_entries", targetId: id, details: diff });
  }
  return NextResponse.json({ ok: true });
}
