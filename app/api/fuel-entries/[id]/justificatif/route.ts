import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { ROLES_CORRECTION_PLEIN } from "@/lib/ticpe/corrections";
import { corrigerJustificatif, reponseCorrection } from "@/lib/ticpe/corrections-serveur";

const schema = z.object({
  type: z.enum(["releve_carte", "facture"]).nullable(),
  ref: z.string().trim().max(120).nullable(),
});

/**
 * Justificatif TICPE d'un plein sans photo de ticket : relevé de carte
 * carburant ou facture (le document est conservé par l'entreprise, pas
 * joint). Encadrement (manager : son service, sous la RLS de fuel_entries) et
 * comptable (qui prépare la déclaration ; client service borné à son
 * organisation) : le comptable corrige le justificatif sans obtenir la
 * validation hiérarchique. Journalisé. Pour joindre la photo du ticket :
 * app/api/fuel-entries/[id]/ticket.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ roles: ROLES_CORRECTION_PLEIN, modules: ["ticpe_export"] });
  if (!g.ok) return g.reponse;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Justificatif invalide." }, { status: 400 });
  return reponseCorrection(await corrigerJustificatif(g, id, parsed.data));
}
