import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { renommerLieu, supprimerLieu } from "@/lib/go-lieux/serveur";

export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();
const corpsSchema = z.object({ libelle: z.string().trim().min(1, "Donnez un nom au lieu.").max(60) });

/** Renommer un favori nommé. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await garderApi({ ecran: "moi.tournee_colis" });
  if (!g.ok) return g.reponse;
  const id = idSchema.safeParse((await params).id);
  const corps = corpsSchema.safeParse(await req.json().catch(() => null));
  if (!id.success || !corps.success) return NextResponse.json({ error: corps.success ? "Lieu invalide." : (corps.error.issues[0]?.message ?? "Nom invalide.") }, { status: 400 });
  const r = await renommerLieu(g.supabase, g.appUser.id, id.data, corps.data.libelle);
  return r.ok ? NextResponse.json({ lieu: r.valeur }) : NextResponse.json({ error: r.message }, { status: r.statut });
}

/** Supprimer un favori ou un récent. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await garderApi({ ecran: "moi.tournee_colis" });
  if (!g.ok) return g.reponse;
  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "Lieu invalide." }, { status: 400 });
  const r = await supprimerLieu(g.supabase, g.appUser.id, id.data);
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.message }, { status: r.statut });
}
