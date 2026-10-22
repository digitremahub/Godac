import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { journaliser } from "@/lib/audit/journal";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { REGIMES_TVA } from "@/lib/ticpe/reglages";

const schema = z
  .object({
    periode_cle: z.string().min(1).max(40),
    periode_libelle: z.string().max(80).nullable(),
    periode_debut: z.string().date(),
    periode_fin: z.string().date(),
    regime_tva: z.enum(REGIMES_TVA),
    declaree_le: z.string().date(),
    montant: z.number().min(0).max(100_000_000),
    litres: z.number().min(0).nullable(),
    montant_calcule: z.number().min(0).nullable(),
    note: z.string().trim().max(1000).nullable(),
  })
  .refine((d) => d.periode_fin >= d.periode_debut, { message: "Période invalide.", path: ["periode_fin"] });

/**
 * Marque une période « déclarée le … » avec le montant demandé, pour ne
 * pas la compter deux fois dans « argent non réclamé ». Direction et
 * comptable (RLS en base).
 */
export async function POST(req: Request) {
  const g = await garderApi({ roles: ["direction", "comptable"], modules: ["ticpe_export"] });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Saisie invalide." }, { status: 400 });

  const { data: existantes } = await supabase
    .from("ticpe_declarations")
    .select("id")
    .eq("organization_id", appUser.organization_id)
    .is("annulee_le", null)
    .lte("periode_debut", parsed.data.periode_fin)
    .gte("periode_fin", parsed.data.periode_debut)
    .limit(1);
  if (existantes && existantes.length > 0) {
    return NextResponse.json({ error: "Une déclaration existe déjà sur cette période : annulez-la d'abord si elle est erronée." }, { status: 409 });
  }

  const { data, error } = await supabase
    .from("ticpe_declarations")
    .insert({ organization_id: appUser.organization_id, ...parsed.data, created_by: appUser.id })
    .select("id")
    .single();
  if (error) {
    if (estSchemaManquant(error)) return NextResponse.json({ error: "Indisponible : la migration 20261031000003 n'est pas encore appliquée." }, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await journaliser({ organizationId: appUser.organization_id, userId: appUser.id, action: "ticpe_periode_declaree", targetTable: "ticpe_declarations", targetId: data.id, details: parsed.data });
  return NextResponse.json({ ok: true, id: data.id });
}
