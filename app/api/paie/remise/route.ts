import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { journaliser } from "@/lib/audit/journal";
import { enregistrerChoix } from "@/lib/paie/remise-electronique";

const bodySchema = z.object({ papier: z.boolean() });

/**
 * Le salarié choisit la remise de ses bulletins (art. L3243-2) :
 * électronique (par défaut) ou papier (opposition). Le choix est daté
 * par le serveur et visible de la direction et du comptable.
 */
export async function POST(req: Request) {
  const g = await garderApi({ roles: "tous", modules: ["payslips"] });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Choix invalide." }, { status: 400 });

  const { data: actuel, error: lecture } = await supabase
    .from("payslip_delivery_preferences")
    .select("paper_requested, decided_at")
    .eq("user_id", appUser.id)
    .maybeSingle();
  if (lecture) return NextResponse.json({ error: "Ce réglage n'est pas encore disponible. Demandez le bulletin papier directement à la direction." }, { status: 503 });

  const choix = enregistrerChoix({ actuel, papier: parsed.data.papier, maintenant: new Date() });
  if (!choix.ok) return NextResponse.json({ error: choix.message }, { status: 409 });
  const { error } = await supabase
    .from("payslip_delivery_preferences")
    .upsert({ user_id: appUser.id, organization_id: appUser.organization_id, ...choix.ligne }, { onConflict: "user_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await journaliser({
    organizationId: appUser.organization_id,
    userId: appUser.id,
    action: "paie_remise_choix",
    targetTable: "payslip_delivery_preferences",
    targetId: appUser.id,
    details: { papier: choix.ligne.paper_requested },
  });
  return NextResponse.json({ ok: true, ...choix.ligne });
}
