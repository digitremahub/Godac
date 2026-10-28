import { garderApi } from "@/lib/acces/garde-api";
import { LECTEURS_STOCK } from "@/lib/acces/catalogue";
import { reponseErreur, lireCorps, REQUETE_INVALIDE } from "@/lib/stock/http";
import { produireEtiquettes, schemaImpression } from "@/lib/stock/etiquettes-serveur";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Étiquettes d'unités existantes en PDF, ouvertes par un simple lien (bouton « Imprimer l'étiquette »
 * de la fiche d'unité) : `?unites=<id>,<id>`, `?format=` (a4_2x4, a4_3x7, thermique_100x150,
 * etiquette_62x29), `?debut=` (emplacements déjà utilisés sur la planche). La RLS borne un manager à
 * ses dépôts. Chauffeur, manager, exploitation, direction.
 */
export async function GET(req: Request) {
  const g = await garderApi({ roles: LECTEURS_STOCK, modules: ["stock"] });
  if (!g.ok) return g.reponse;
  const p = new URL(req.url).searchParams;
  const parsed = schemaImpression.safeParse({
    mode: "unites",
    ids: (p.get("unites") ?? "").split(",").map((x) => x.trim()).filter(Boolean),
    ...(p.get("format") ? { format: p.get("format") } : {}),
    ...(p.get("debut") ? { debut: Number(p.get("debut")) } : {}),
  });
  if (!parsed.success) return reponseErreur(REQUETE_INVALIDE);
  return produireEtiquettes(g.supabase, g.appUser, parsed.data);
}

/**
 * Impression par formulaire : étiquettes d'unités (`mode: "unites"`, `ids`) ou planche d'étiquettes
 * vierges numérotées (`mode: "vierges"` avec `nombre` + `cle` pour générer des codes neufs, ou `codes`
 * pour réimprimer). 500 étiquettes au plus par document. Les générations de codes sont journalisées.
 */
export async function POST(req: Request) {
  const g = await garderApi({ roles: LECTEURS_STOCK, modules: ["stock"] });
  if (!g.ok) return g.reponse;
  const parsed = schemaImpression.safeParse(await lireCorps(req));
  if (!parsed.success) return reponseErreur(REQUETE_INVALIDE);
  return produireEtiquettes(g.supabase, g.appUser, parsed.data);
}
