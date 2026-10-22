import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { ENCADREMENT } from "@/lib/acces/catalogue";
import { journaliser } from "@/lib/audit/journal";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";

const schema = z.object({
  type: z.enum(["releve_carte", "facture"]).nullable(),
  ref: z.string().trim().max(120).nullable(),
});

/**
 * Justificatif TICPE d'un plein sans photo de ticket : relevé de carte
 * carburant ou facture (le document est conservé par l'entreprise, pas
 * joint). Encadrement ; RLS de fuel_entries en base.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ roles: ENCADREMENT, modules: ["ticpe_export"] });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Justificatif invalide." }, { status: 400 });
  const { data, error } = await supabase
    .from("fuel_entries")
    .update({ ticpe_justificatif: parsed.data.type, ticpe_justificatif_ref: parsed.data.type ? parsed.data.ref || null : null })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) {
    if (estSchemaManquant(error)) return NextResponse.json({ error: "Indisponible : la migration 20261031000002 n'est pas encore appliquée." }, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Plein introuvable ou hors de votre périmètre." }, { status: 404 });
  await journaliser({ organizationId: appUser.organization_id, userId: appUser.id, action: "plein_modification", targetTable: "fuel_entries", targetId: id, details: { ticpe_justificatif: parsed.data.type, ticpe_justificatif_ref: parsed.data.ref } });
  return NextResponse.json({ ok: true });
}
