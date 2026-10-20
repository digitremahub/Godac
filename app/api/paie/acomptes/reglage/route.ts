import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";

const bodySchema = z.object({
  pourcentage: z.coerce.number().min(0).max(100),
  montant_fixe: z.coerce.number().min(0).max(100000).nullable(),
});

/**
 * Plafond indicatif des demandes d'acompte (payroll_settings) : un
 * montant fixe, sinon un pourcentage du net habituel. Direction seulement,
 * comme les autres réglages de paie.
 */
export async function PUT(req: Request) {
  const g = await garderApi({ roles: ["direction"], modules: ["payslips"] });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Valeurs invalides." }, { status: 400 });
  const { error } = await supabase.from("payroll_settings").upsert(
    {
      organization_id: appUser.organization_id,
      advance_cap_percent: parsed.data.pourcentage,
      advance_cap_amount: parsed.data.montant_fixe && parsed.data.montant_fixe > 0 ? parsed.data.montant_fixe : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id" },
  );
  if (error) {
    const absent = /advance_cap/.test(error.message);
    return NextResponse.json(
      { error: absent ? "Réglage indisponible tant que la mise à jour de la base n'est pas appliquée." : error.message },
      { status: absent ? 503 : 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
