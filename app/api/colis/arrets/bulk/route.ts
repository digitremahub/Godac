import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { geocodeAddressDetail, reverseGeocode } from "@/lib/geo/geocode";
import { codePays } from "@/lib/pays/serveur";
import { normaliserTelephone } from "@/lib/colis/telephone";
import { cleAdresse, listeDeLaTournee, materialiserListePrincipale, moduleActif, tourneeParId, LIST_FIELDS } from "@/lib/colis/serveur";
import { chargerContexteRangement, listePourAdresse } from "@/lib/colis/villages-serveur";

const pointSchema = z.object({
  adresse: z.string().trim().max(300).nullable(),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
  nom: z.string().trim().max(120).nullable(),
  telephone: z.string().trim().max(40).nullable().optional(),
});
// Géocodage d'une longue liste hors de France (une adresse par seconde).
export const maxDuration = 300;

const bodySchema = z.object({
  run_id: z.string().uuid(),
  points: z.array(pointSchema).min(1).max(200),
  /** Liste existante de la tournée où importer… */
  list_id: z.string().uuid().nullable().optional(),
  /** …ou nom d'une nouvelle liste à créer pour cet import (ex. le nom du fichier). */
  nouvelle_liste: z.string().trim().min(1).max(60).nullable().optional(),
});

/** Exécute `fn` sur chaque élément, au plus `n` à la fois (géocodage sans saturer l'API). */
async function parLots<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]!);
      }
    }),
  );
  return out;
}

/**
 * Ajout d'une liste importée (Google Maps, fichier, liste collée) : les
 * adresses sont géocodées, les points sans adresse reçoivent l'adresse la
 * plus proche, et une adresse déjà présente rejoint l'arrêt existant.
 */
export async function POST(req: Request) {
  const g = await garderApi({ modules: ["route_optimizer"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Liste invalide (200 adresses au plus)." }, { status: 400 });
  const run = await tourneeParId(supabase, appUser, parsed.data.run_id);
  if (!run) return NextResponse.json({ error: "Tournée introuvable." }, { status: 404 });
  let listId = parsed.data.list_id ?? null;
  if (listId && !(await listeDeLaTournee(supabase, run.id, listId))) return NextResponse.json({ error: "Liste introuvable dans cette tournée." }, { status: 400 });

  // Hors de France, OpenStreetMap (Nominatim) demande une requête à la fois.
  const pays = await codePays(appUser.organization_id);
  const complets = await parLots(parsed.data.points, pays === "FR" ? 6 : 1, async (p) => {
    // Nominatim : une requête par seconde au plus (conditions d'utilisation d'OpenStreetMap).
    if (pays !== "FR") await new Promise((r) => setTimeout(r, 1000));
    let { adresse, lat, lng } = p;
    let commune: string | null = null;
    let codePostal: string | null = null;
    if ((lat === null || lng === null) && adresse) {
      const geo = await geocodeAddressDetail(adresse, pays);
      lat = geo?.lat ?? null;
      lng = geo?.lng ?? null;
      commune = geo?.city ?? null;
      codePostal = geo?.postcode ?? null;
    }
    if (!adresse && lat !== null && lng !== null) adresse = (await reverseGeocode(lat, lng, pays)) ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    return adresse && adresse.length >= 3 ? { adresse, lat, lng, commune, codePostal, nom: p.nom, telephone: normaliserTelephone(p.telephone, pays) } : null;
  });

  // Import dans une nouvelle liste : la liste implicite devient d'abord une
  // vraie liste (en tête), la nouvelle se place après les autres.
  if (!listId && parsed.data.nouvelle_liste) {
    try {
      const listes = await materialiserListePrincipale(supabase, appUser.organization_id, run.id);
      const { data: cree, error } = await supabase
        .from("delivery_lists")
        .insert({ organization_id: appUser.organization_id, run_id: run.id, name: parsed.data.nouvelle_liste, position: listes.reduce((m, l) => Math.max(m, l.position), -1) + 1 })
        .select(LIST_FIELDS)
        .single();
      if (error) throw new Error(error.message);
      listId = cree.id as string;
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Création de la liste impossible." }, { status: 500 });
    }
  }

  // Liste choisie (ou nouvelle liste nommée) : tout l'import y va. Sinon,
  // rangement automatique : village de la tournée par commune ou proximité,
  // « Hors tournée » pour le reste (tournée sans villages : liste de la commune).
  const listeChoisie = listId;
  const contexte = listeChoisie ? null : await chargerContexteRangement(supabase, run.id);
  const listeDe = new Map<number, string | null>();
  for (const [k, p] of complets.entries()) {
    if (!p) continue;
    if (listeChoisie || !contexte) listeDe.set(k, listeChoisie);
    else {
      const r = await listePourAdresse(supabase, appUser, run.id, { texte: p.adresse, commune: p.commune, codePostal: p.codePostal, point: p.lat !== null && p.lng !== null ? { lat: p.lat, lng: p.lng } : null }, contexte);
      listeDe.set(k, r.listId);
    }
  }

  const { data: existants } = await supabase.from("delivery_stops").select("id, list_id, address, parcel_count, phone, status, position").eq("run_id", run.id);
  // Regroupement par commune/liste ET adresse : un même lieu ne crée pas deux arrêts.
  const parCle = new Map((existants ?? []).filter((s) => s.status === "pending").map((s) => [`${s.list_id ?? ""}|${cleAdresse(s.address)}`, s]));
  let position = (existants ?? []).reduce((m, s) => Math.max(m, s.position), -1) + 1;
  const nouveaux = new Map<string, Record<string, unknown>>();
  let regroupes = 0;
  let ignores = 0;

  for (const [k, p] of complets.entries()) {
    if (!p) {
      ignores++;
      continue;
    }
    const listePoint = listeDe.get(k) ?? null;
    const cle = `${listePoint ?? ""}|${cleAdresse(p.adresse)}`;
    const existant = parCle.get(cle);
    const nouveau = nouveaux.get(cle);
    if (existant) {
      regroupes++;
      existant.parcel_count += 1;
      if (!existant.phone && p.telephone) existant.phone = p.telephone;
      await supabase.from("delivery_stops").update({ parcel_count: existant.parcel_count, phone: existant.phone }).eq("id", existant.id);
    } else if (nouveau) {
      regroupes++;
      nouveau.parcel_count = (nouveau.parcel_count as number) + 1;
      if (!nouveau.phone && p.telephone) nouveau.phone = p.telephone;
    } else {
      nouveaux.set(cle, {
        organization_id: appUser.organization_id,
        run_id: run.id,
        ...(listePoint ? { list_id: listePoint } : {}),
        position: position++,
        address: p.adresse,
        recipient: p.nom,
        phone: p.telephone,
        lat: p.lat,
        lng: p.lng,
        parcel_count: 1,
      });
    }
  }

  if (nouveaux.size) {
    const { error } = await supabase.from("delivery_stops").insert([...nouveaux.values()]);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const sansGps = [...nouveaux.values()].filter((s) => s.lat === null).length;
  // Nouvelles adresses avant le départ : l'ordre est à recalculer (fait au lancement).
  if (nouveaux.size && run.status === "loading" && run.optimized_at) await supabase.from("delivery_runs").update({ optimized_at: null }).eq("id", run.id);
  return NextResponse.json({ ajoutes: nouveaux.size, regroupes, ignores, sansGps, list_id: listId });
}
