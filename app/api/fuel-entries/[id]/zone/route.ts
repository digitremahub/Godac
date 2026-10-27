import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { ROLES_CORRECTION_PLEIN } from "@/lib/ticpe/corrections";
import { corrigerZone, reponseCorrection } from "@/lib/ticpe/corrections-serveur";

const schema = z.object({
  /** null = non renseignée : zone de la cuve, sinon zone par défaut de l'organisation. */
  ticpe_zone: z.enum(["metropole", "corse"]).nullable(),
  /** Code pays ISO ; null = non renseigné (France). */
  pays_achat: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Code pays à deux lettres (FR, BE, ES…).")
    .nullable(),
  confirmer_periode_declaree: z.boolean().optional(),
});

/**
 * Zone TICPE (Corse / métropole) et pays d'achat d'un plein, saisis par
 * l'encadrement (manager : son service) ou le comptable (qui prépare la
 * déclaration, sans validation hiérarchique). Le nom de la station ne décide
 * jamais de la zone. Un plein acheté hors de France n'est pas compté.
 * Journalisé (avant / après).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ roles: ROLES_CORRECTION_PLEIN, modules: ["ticpe_export"] });
  if (!g.ok) return g.reponse;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Zone ou pays invalide." }, { status: 400 });
  return reponseCorrection(await corrigerZone(g, id, parsed.data));
}
