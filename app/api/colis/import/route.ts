import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { extraireLien, idListeGoogle, lireLienGoogleMaps, lireListeGoogle } from "@/lib/colis/import";
import { moduleActif } from "@/lib/colis/serveur";

// Le texte partagé par l'application Google Maps contient souvent une phrase autour du lien.
const bodySchema = z.object({ url: z.string().trim().min(8).max(4000) });

/** Seuls les domaines Google sont suivis : jamais de requête vers un site quelconque. */
const GOOGLE = /^(maps\.app\.goo\.gl|goo\.gl|g\.co|maps\.google\.[a-z.]+|(www\.)?google\.[a-z.]+|consent\.google\.[a-z.]+)$/i;

/** Évite la page de consentement (cookies) servie aux visiteurs européens. */
const EN_TETES = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36",
  "Accept-Language": "fr-FR,fr;q=0.9",
  Cookie: "CONSENT=YES+cb; SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmZyIAEaBgiA_LyaBg",
};

/**
 * Lien Google Maps partagé → liste des étapes :
 * - itinéraire (…/maps/dir/…) : les étapes sont dans l'adresse ;
 * - liste enregistrée (« Partager la liste », …/placelists/list/<id>) : les
 *   lieux sont lus sur l'aperçu de la liste (format non documenté par
 *   Google, lu de façon tolérante) ;
 * le lien court (maps.app.goo.gl) est résolu ici en suivant ses
 * redirections, le navigateur ne pouvant pas le faire (CORS).
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json());
  const lien = parsed.success ? extraireLien(parsed.data.url) : null;
  if (!lien) return NextResponse.json({ error: "Collez le lien Google Maps (ou tout le texte partagé)." }, { status: 400 });

  let url = lien;
  for (let saut = 0; saut < 6; saut++) {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return NextResponse.json({ error: "Lien illisible." }, { status: 400 });
    }
    if (u.protocol !== "https:" || !GOOGLE.test(u.hostname)) return NextResponse.json({ error: "Ce lien n'est pas un lien Google Maps." }, { status: 400 });
    // Page de consentement : l'adresse visée est dans « continue ».
    if (/^consent\./i.test(u.hostname)) {
      const suite = u.searchParams.get("continue");
      if (!suite) break;
      url = suite;
      continue;
    }
    if (u.pathname.includes("/maps/dir/") || u.searchParams.has("destination") || idListeGoogle(url)) break;
    let res: Response;
    try {
      res = await fetch(url, { redirect: "manual", headers: EN_TETES, signal: AbortSignal.timeout(6000) });
    } catch {
      return NextResponse.json({ error: "Google Maps ne répond pas, réessayez." }, { status: 502 });
    }
    const suivant = res.headers.get("location");
    if (!suivant) break;
    url = new URL(suivant, url).toString();
  }

  const idListe = idListeGoogle(url);
  if (idListe) {
    const points = await lireListeEnregistree(idListe);
    if (points.length) return NextResponse.json({ points });
    return NextResponse.json(
      {
        error:
          "Google n'a pas donné le contenu de cette liste. Vérifiez qu'elle est partagée (« Partager la liste » → toute personne disposant du lien), ou importez le fichier de la liste (Google Takeout, CSV/KML).",
      },
      { status: 422 },
    );
  }

  const points = lireLienGoogleMaps(url);
  if (!points.length) {
    return NextResponse.json(
      { error: "Aucune adresse dans ce lien. Partagez un itinéraire ou une liste (« Partager la liste »), ou importez le fichier de votre liste." },
      { status: 422 },
    );
  }
  return NextResponse.json({ points });
}

async function lireListeEnregistree(id: string) {
  const pb = `!1m4!1s${id}!2e1!3m1!1e1!2e2!3e2!4i500!16b1`;
  try {
    const res = await fetch(`https://www.google.com/maps/preview/entitylist/getlist?authuser=0&hl=fr&gl=fr&pb=${encodeURIComponent(pb)}`, {
      headers: EN_TETES,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    return lireListeGoogle(await res.text());
  } catch {
    return [];
  }
}
