import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { ROLES_CORRECTION_PLEIN } from "@/lib/ticpe/corrections";
import { corrigerDoublon, reponseCorrection } from "@/lib/ticpe/corrections-serveur";

const schema = z.object({ lever: z.boolean(), confirmer_periode_declaree: z.boolean().optional() });

/**
 * Lève (ou rétablit) un doublon probable : une personne de l'encadrement
 * (manager : son service) ou le comptable confirme, après vérification, que ce
 * plein est distinct de celui qui lui ressemble (deux vrais pleins). Tant que
 * ce n'est pas fait, l'une des deux lignes n'est pas comptée dans le montant
 * TICPE. Le comptable n'obtient pas pour autant la validation hiérarchique.
 * Journalisé.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ roles: ROLES_CORRECTION_PLEIN, modules: ["ticpe_export"] });
  if (!g.ok) return g.reponse;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Demande invalide." }, { status: 400 });
  return reponseCorrection(await corrigerDoublon(g, id, parsed.data));
}
