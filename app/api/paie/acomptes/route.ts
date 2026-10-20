import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { moisCourantParis, verifierDemande } from "@/lib/paie/acomptes";
import { MESSAGE_TABLE_ABSENTE, plafondDuSalarie, tableAcomptesAbsente } from "@/lib/paie/acomptes-serveur";

const bodySchema = z.object({
  montant: z.coerce.number().positive().max(100000),
  motif: z.string().trim().max(500).optional().nullable(),
});

/**
 * Demande d'acompte d'un salarié, pour lui-même et pour le mois en cours.
 * Le plafond est indicatif : au-delà, la demande part avec un
 * avertissement et la direction décide. La base (RLS + trigger
 * salary_advance_requests_guard_author) fixe le statut « en attente » et
 * alerte direction et comptable.
 */
export async function POST(req: Request) {
  const g = await garderApi({ roles: "tous", modules: ["payslips"] });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Indiquez un montant valide." }, { status: 400 });
  const montant = Math.round(parsed.data.montant * 100) / 100;
  const mois = moisCourantParis();
  const period = `${mois}-01`;

  const { data: duMois, error: lectureError } = await supabase
    .from("salary_advance_requests")
    .select("status")
    .eq("user_id", appUser.id)
    .eq("period", period);
  if (lectureError) {
    if (tableAcomptesAbsente(lectureError)) return NextResponse.json({ error: MESSAGE_TABLE_ABSENTE }, { status: 503 });
    return NextResponse.json({ error: lectureError.message }, { status: 500 });
  }

  const { plafond } = await plafondDuSalarie(supabase, appUser.organization_id, appUser.id);
  const verdict = verifierDemande({ montant, plafond, demandesDuMois: (duMois ?? []) as { status: "en_attente" }[] });
  if (!verdict.ok) return NextResponse.json({ error: verdict.message }, { status: 422 });

  const { data, error } = await supabase
    .from("salary_advance_requests")
    .insert({
      organization_id: appUser.organization_id,
      user_id: appUser.id,
      period,
      amount_requested: montant,
      reason: parsed.data.motif?.trim() || null,
    })
    .select("id")
    .single();
  if (error) {
    if (tableAcomptesAbsente(error)) return NextResponse.json({ error: MESSAGE_TABLE_ABSENTE }, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ id: data.id, avertissement: verdict.avertissement });
}
