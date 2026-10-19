import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { materialiserListePrincipale, moduleActif, tourneeParId, LIST_FIELDS } from "@/lib/colis/serveur";
import { nomNouvelleListe } from "@/lib/colis/listes";

const bodySchema = z.object({
  run_id: z.string().uuid(),
  name: z.string().trim().max(60).nullable().optional(),
  /**
   * Nommer la liste implicite (« Liste principale ») sans en créer une
   * autre : elle devient une vraie liste, renommable.
   */
  principale: z.boolean().optional(),
});

/**
 * Nouvelle liste dans une tournée (nom par défaut « Liste N »), placée
 * après les autres. À la première liste créée, les arrêts déjà chargés
 * forment la liste « Liste principale » en tête.
 */
export async function POST(req: Request) {
  const g = await garderApi({ modules: ["route_optimizer"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Nom de liste invalide." }, { status: 400 });
  const run = await tourneeParId(supabase, appUser, parsed.data.run_id);
  if (!run) return NextResponse.json({ error: "Tournée introuvable." }, { status: 404 });

  try {
    if (parsed.data.principale) {
      const listes = await materialiserListePrincipale(supabase, appUser.organization_id, run.id, parsed.data.name);
      return NextResponse.json({ list: listes[0] });
    }
    const listes = await materialiserListePrincipale(supabase, appUser.organization_id, run.id);
    const { data, error } = await supabase
      .from("delivery_lists")
      .insert({
        organization_id: appUser.organization_id,
        run_id: run.id,
        name: parsed.data.name?.trim() || nomNouvelleListe(listes),
        position: listes.reduce((m, l) => Math.max(m, l.position), -1) + 1,
      })
      .select(LIST_FIELDS)
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ list: data });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Création de la liste impossible." }, { status: 500 });
  }
}
