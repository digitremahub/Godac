import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { ENCADREMENT } from "@/lib/acces/catalogue";
import { journaliser } from "@/lib/audit/journal";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";

const schema = z.object({ lever: z.boolean() });

/**
 * Lève (ou rétablit) un doublon probable : une personne de l'encadrement
 * confirme que ce plein est distinct de celui qui lui ressemble (deux vrais
 * pleins). Tant que ce n'est pas fait, l'une des deux lignes n'est pas
 * comptée dans le montant TICPE. Journalisé. RLS de fuel_entries en base.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ roles: ENCADREMENT, modules: ["ticpe_export"] });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Demande invalide." }, { status: 400 });
  const maintenant = new Date().toISOString();
  const { data, error } = await supabase
    .from("fuel_entries")
    .update(parsed.data.lever ? { ticpe_doublon_leve_le: maintenant, ticpe_doublon_leve_par: appUser.id } : { ticpe_doublon_leve_le: null, ticpe_doublon_leve_par: null })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) {
    if (estSchemaManquant(error)) return NextResponse.json({ error: "Indisponible : la migration 20261101000003 n'est pas encore appliquée." }, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Plein introuvable ou hors de votre périmètre." }, { status: 404 });
  await journaliser({
    organizationId: appUser.organization_id,
    userId: appUser.id,
    action: "plein_doublon_leve",
    targetTable: "fuel_entries",
    targetId: id,
    details: { doublon_leve: parsed.data.lever },
  });
  return NextResponse.json({ ok: true });
}
