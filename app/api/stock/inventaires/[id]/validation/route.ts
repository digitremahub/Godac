import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { ENCADREMENT } from "@/lib/acces/catalogue";
import { journaliser } from "@/lib/audit/journal";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { alerterEcartInventaire, reevaluerSeuils } from "@/lib/stock/alertes-serveur";
import { traduireErreurStock } from "@/lib/stock/erreurs";
import { lireCorps, reponseErreur, REQUETE_INVALIDE } from "@/lib/stock/http";
import { chargerInventaire } from "@/lib/stock/requetes-serveur";
import { phraseBilan } from "@/lib/stock/inventaire";

const corps = z.object({ cle: z.string().min(8).max(100), confirmer: z.literal(true) });

/**
 * Valide l'inventaire : les écarts sont corrigés par des mouvements d'ajustement
 * (liés à l'inventaire, dans le registre), en une seule transaction. Manager de
 * ses services, exploitation, direction. Action sensible : journalisée, et une
 * alerte est adressée à l'encadrement s'il y a des écarts. Rejouable (même clé).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await garderApi({ roles: ENCADREMENT, modules: ["stock"] });
  if (!g.ok) return g.reponse;
  const { id } = await params;
  const parsed = corps.safeParse(await lireCorps(req));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) return reponseErreur({ ...REQUETE_INVALIDE, message: "Confirmez la validation de l'inventaire." });
  const { supabase, appUser } = g;
  const avant = await chargerInventaire(supabase, appUser.organization_id, id);
  const { data, error } = await supabase.rpc("stock_valider_inventaire", { p_inventaire: id, p_cle: parsed.data.cle });
  if (error) return reponseErreur(traduireErreurStock(error));
  const r = (data ?? {}) as { ecarts?: number; doublon?: boolean };
  const ecarts = Number(r.ecarts ?? 0);
  if (!r.doublon) {
    await journaliser({ organizationId: appUser.organization_id, userId: appUser.id, action: "stock_inventaire_valide", targetTable: "stock_inventaires", targetId: id, details: { ecarts, depot: avant?.site?.nom ?? null, zone: avant?.zone?.code ?? null } });
    if (ecarts > 0 && avant?.site) {
      await alerterEcartInventaire(createAdminSupabaseClient(), { organizationId: appUser.organization_id, inventaireId: id, site: avant.site.nom, serviceId: avant.site.service_id, phrase: phraseBilan(avant.bilan) });
    }
    await reevaluerSeuils(appUser.organization_id);
  }
  return NextResponse.json({ ok: true, doublon: Boolean(r.doublon), ecarts });
}
