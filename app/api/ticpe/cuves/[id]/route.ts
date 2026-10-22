import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { journaliser } from "@/lib/audit/journal";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";

/** Zone TICPE d'une cuve (Corse ou métropole) : direction (RLS de tanks en base). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ roles: ["direction"], modules: ["ticpe_export"] });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const parsed = z.object({ ticpe_zone: z.enum(["metropole", "corse"]) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Zone invalide." }, { status: 400 });
  const { data, error } = await supabase.from("tanks").update(parsed.data).eq("id", id).select("id").maybeSingle();
  if (error) {
    if (estSchemaManquant(error)) return NextResponse.json({ error: "Indisponible : la migration 20261031000002 n'est pas encore appliquée." }, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Cuve introuvable." }, { status: 404 });
  await journaliser({ organizationId: appUser.organization_id, userId: appUser.id, action: "ticpe_reglages_modifies", targetTable: "tanks", targetId: id, details: parsed.data });
  return NextResponse.json({ ok: true });
}
