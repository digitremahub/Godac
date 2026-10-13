import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { lireLienGoogleMaps } from "@/lib/colis/import";
import { moduleActif } from "@/lib/colis/serveur";

const bodySchema = z.object({ url: z.string().trim().url().max(4000) });

/** Seuls les domaines Google sont suivis : jamais de requête vers un site quelconque. */
const GOOGLE = /^(maps\.app\.goo\.gl|goo\.gl|g\.co|maps\.google\.[a-z.]+|(www\.)?google\.[a-z.]+)$/i;

/**
 * Lien Google Maps partagé (souvent court : maps.app.goo.gl/…) → liste
 * des étapes. Le lien court est résolu ici en suivant ses redirections,
 * le navigateur ne pouvant pas le faire (CORS).
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Collez un lien Google Maps." }, { status: 400 });

  let url = parsed.data.url;
  for (let saut = 0; saut < 5; saut++) {
    const u = new URL(url);
    if (u.protocol !== "https:" || !GOOGLE.test(u.hostname)) return NextResponse.json({ error: "Ce lien n'est pas un lien Google Maps." }, { status: 400 });
    if (u.pathname.includes("/maps/dir/") || u.searchParams.has("destination")) break;
    let res: Response;
    try {
      res = await fetch(url, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0 (GODAC)" }, signal: AbortSignal.timeout(6000) });
    } catch {
      return NextResponse.json({ error: "Google Maps ne répond pas, réessayez." }, { status: 502 });
    }
    const suivant = res.headers.get("location");
    if (!suivant) break;
    url = new URL(suivant, url).toString();
  }

  const points = lireLienGoogleMaps(url);
  if (!points.length) {
    return NextResponse.json(
      { error: "Aucune adresse dans ce lien. Partagez un itinéraire (bouton « Itinéraire » puis « Partager »), ou importez le fichier de votre liste." },
      { status: 422 },
    );
  }
  return NextResponse.json({ points });
}
