import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { journaliser } from "@/lib/audit/journal";
import { ACTIONS_LOT, LOT_MAX, normaliserLot } from "@/lib/ticpe/corrections";
import { corrigerDoublon, corrigerJustificatif, corrigerZone, type ResultatCorrection } from "@/lib/ticpe/corrections-serveur";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("justificatif"),
    ids: z.array(z.string().uuid()).min(1).max(LOT_MAX),
    type: z.enum(["releve_carte", "facture"]),
    ref: z.string().trim().max(120).nullable().optional(),
  }),
  z.object({
    action: z.literal("zone"),
    ids: z.array(z.string().uuid()).min(1).max(LOT_MAX),
    ticpe_zone: z.enum(["metropole", "corse"]).nullable(),
    pays_achat: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Code pays à deux lettres (FR, BE, ES…).").nullable(),
    confirmer_periode_declaree: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("doublon"),
    ids: z.array(z.string().uuid()).min(1).max(LOT_MAX),
    confirmer_periode_declaree: z.boolean().optional(),
  }),
]);

/**
 * Correction en lot des points bloquants TICPE (écran « TICPE : à régler ») :
 * joindre un justificatif (relevé ou facture), confirmer la zone et le pays,
 * ou confirmer deux pleins distincts après vérification, sur plusieurs pleins
 * à la fois (50 au plus). Direction, exploitation et comptable, comme l'écran.
 *
 * Plein par plein, avec les mêmes règles et la même trace d'audit que les
 * routes d'un plein (lib/ticpe/corrections-serveur.ts) : un plein hors du
 * périmètre ou d'une période déjà déclarée sans confirmation est refusé sans
 * bloquer les autres. Jamais de modification des litres ni des montants, et
 * aucune validation hiérarchique donnée au comptable.
 */
export async function POST(req: Request) {
  const g = await garderApi({ ecran: "carburant.ticpe_controles" });
  if (!g.ok) return g.reponse;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message;
    return NextResponse.json({ error: message && !/Invalid|Required/i.test(message) ? message : `Demande invalide (action : ${ACTIONS_LOT.join(", ")} ; ${LOT_MAX} pleins au plus).` }, { status: 400 });
  }
  const d = parsed.data;
  const ids = normaliserLot(d.ids);

  const appliquer = (id: string): Promise<ResultatCorrection> => {
    if (d.action === "justificatif") return corrigerJustificatif(g, id, { type: d.type, ref: d.ref ?? null });
    if (d.action === "zone") return corrigerZone(g, id, { ticpe_zone: d.ticpe_zone, pays_achat: d.pays_achat, confirmer_periode_declaree: d.confirmer_periode_declaree });
    return corrigerDoublon(g, id, { lever: true, confirmer_periode_declaree: d.confirmer_periode_declaree });
  };

  let traites = 0;
  const refuses: { id: string; error: string; code?: string }[] = [];
  for (const id of ids) {
    const r = await appliquer(id);
    if (r.ok) traites++;
    else refuses.push({ id, error: r.error, ...(r.code ? { code: r.code } : {}) });
  }
  await journaliser({
    organizationId: g.appUser.organization_id,
    userId: g.appUser.id,
    action: "plein_correction_lot",
    details: { action: d.action, demandes: ids.length, traites, refuses: refuses.length },
  });
  return NextResponse.json({ ok: true, traites, refuses });
}
