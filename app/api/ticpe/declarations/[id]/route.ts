import { NextResponse } from "next/server";
import { garderApi } from "@/lib/acces/garde-api";
import { journaliser } from "@/lib/audit/journal";

/** Annule une déclaration marquée par erreur (la ligne reste, pour la traçabilité). */
export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ roles: ["direction", "comptable"], modules: ["ticpe_export"] });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const { data, error } = await supabase
    .from("ticpe_declarations")
    .update({ annulee_le: new Date().toISOString(), annulee_par: appUser.id })
    .eq("id", id)
    .is("annulee_le", null)
    .select("id, periode_cle, montant")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Déclaration introuvable ou déjà annulée." }, { status: 404 });
  await journaliser({ organizationId: appUser.organization_id, userId: appUser.id, action: "ticpe_declaration_annulee", targetTable: "ticpe_declarations", targetId: id, details: data });
  return NextResponse.json({ ok: true });
}
