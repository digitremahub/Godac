import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { journaliser } from "@/lib/audit/journal";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { reponseErreurBase } from "@/lib/partage-go/serveur";

const bodySchema = z.union([
  z.object({ tous: z.boolean() }).strict(),
  z.object({ userId: z.string().uuid(), autorise: z.boolean() }).strict(),
]);

/**
 * Direction seulement : ouvre « Faire essayer GO » à toute l'équipe
 * ({ tous }) ou à une personne désignée ({ userId, autorise }). La direction
 * garde toujours le droit. Écriture par le client service, bornée à
 * l'organisation de la direction connectée.
 */
export async function PATCH(req: Request) {
  const g = await garderApi({ roles: ["direction"] });
  if (!g.ok) return g.reponse;
  const { appUser } = g;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Demande invalide." }, { status: 400 });

  const admin = createAdminSupabaseClient();
  if ("tous" in parsed.data) {
    const { error } = await admin.from("organizations").update({ partage_go_tous: parsed.data.tous }).eq("id", appUser.organization_id);
    if (error) return reponseErreurBase("réglage toute l'équipe", error);
    await journaliser({ organizationId: appUser.organization_id, userId: appUser.id, action: "go_apporteur_droit_modifie", targetTable: "organizations", targetId: appUser.organization_id, details: { tous: parsed.data.tous } });
    return NextResponse.json({ ok: true });
  }

  const { data, error } = await admin
    .from("users")
    .update({ peut_partager_go: parsed.data.autorise })
    .eq("id", parsed.data.userId)
    .eq("organization_id", appUser.organization_id)
    .select("id")
    .maybeSingle();
  if (error) return reponseErreurBase("droit d'une personne", error);
  if (!data) return NextResponse.json({ error: "Personne introuvable dans votre organisation." }, { status: 404 });
  await journaliser({ organizationId: appUser.organization_id, userId: appUser.id, action: "go_apporteur_droit_modifie", targetTable: "users", targetId: parsed.data.userId, details: { autorise: parsed.data.autorise } });
  return NextResponse.json({ ok: true });
}
