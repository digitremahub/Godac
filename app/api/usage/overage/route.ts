import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({ enabled: z.boolean() });

/** « Autoriser le dépassement facturé » (page Abonnement › Consommation) — réservé à la direction. */
export async function PATCH(req: Request) {
  const g = await garderApi({ roles: ["direction"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (appUser.role !== "direction") return NextResponse.json({ error: "Réservé à la direction." }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("organizations")
    .update({ usage_overage_enabled: parsed.data.enabled })
    .eq("id", appUser.organization_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, enabled: parsed.data.enabled });
}
