import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { LECTEURS_STOCK } from "@/lib/acces/catalogue";
import { journaliser } from "@/lib/audit/journal";
import { CODES_MAX_PAR_APPEL } from "@/lib/stock/codes";
import { traduireErreurStock } from "@/lib/stock/erreurs";
import { lireCorps, reponseErreur, REQUETE_INVALIDE } from "@/lib/stock/http";
import { genererCodesInternes } from "@/lib/stock/codes-serveur";

const corps = z.object({
  nombre: z.number().int().min(1).max(CODES_MAX_PAR_APPEL),
  /** Clé d'idempotence : rejouer la même demande renvoie les mêmes codes sans en consommer d'autres. */
  cle: z.string().min(8).max(100),
});

/**
 * Génère `nombre` codes internes uniques (PREFIXE-AAAA-NNNNNN) pour l'entreprise : un seul code
 * à l'entrée d'une unité sans code, ou une planche de codes d'avance à imprimer. Compteur atomique
 * côté base (fonction SQL stock_generer_codes), 500 codes au plus par appel, rejouable par clé.
 * Chauffeur, manager, exploitation, direction. Les générations en masse sont journalisées.
 */
export async function POST(req: Request) {
  const g = await garderApi({ roles: LECTEURS_STOCK, modules: ["stock"] });
  if (!g.ok) return g.reponse;
  const parsed = corps.safeParse(await lireCorps(req));
  if (!parsed.success) return reponseErreur(parsed.error.issues.some((i) => i.path[0] === "nombre") ? { code: "stock_nombre_invalide", message: "Indiquez un nombre de codes entre 1 et 500.", status: 400 } : REQUETE_INVALIDE);
  const r = await genererCodesInternes(g.supabase, g.appUser, parsed.data.nombre, parsed.data.cle, "api");
  if (!r.ok) return reponseErreur(r.erreur);
  return NextResponse.json({ ok: true, doublon: r.doublon, codes: r.codes, prefixe: r.prefixe, annee: r.annee });
}
