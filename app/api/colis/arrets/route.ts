import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { geocodeAddress } from "@/lib/geo/geocode";
import { codePays } from "@/lib/pays/serveur";
import { normaliserTelephone } from "@/lib/colis/telephone";
import { typeArret } from "@/lib/colis/livraison";
import { POIDS_MAX_KG, lirePoids } from "@/lib/colis/poids";
import { cleAdresse, listeDeLaTournee, moduleActif, tourneeParId, STOP_FIELDS } from "@/lib/colis/serveur";

/** Extrait le nom de commune des adresses BAN courantes (« 66000 Perpignan »). */
function communeDepuisAdresse(adresse: string): string | null {
  const sansPays = adresse.split(",").map((x) => x.trim()).filter(Boolean).filter((x) => !/^(france|fr)$/i.test(x));
  const avecCodePostal = [...sansPays].reverse().find((partie) => /^\d{5}\s+/.test(partie));
  if (avecCodePostal) {
    const ville = avecCodePostal.replace(/^\d{5}\s+/, "").replace(/\s+\([^)]*\)$/, "").trim();
    if (ville.length >= 2 && ville.length <= 80) return ville;
  }
  const derniere = sansPays[sansPays.length - 1];
  if (sansPays.length >= 2 && derniere && derniere.length >= 2 && derniere.length <= 80 && !/^\d/.test(derniere)) return derniere;
  return null;
}

const bodySchema = z.object({
  run_id: z.string().uuid(),
  /** Liste de la tournée où ranger le colis (sinon la liste implicite). */
  list_id: z.string().uuid().nullable().optional(),
  code: z.string().trim().max(120).nullable().optional(),
  adresse: z.string().trim().min(5).max(300),
  destinataire: z.string().trim().max(120).nullable().optional(),
  telephone: z.string().trim().max(40).nullable().optional(),
  /** Livraison (par défaut) ou ramasse. */
  type: z.enum(["livraison", "ramasse", "point_relais"]).optional(),
  /** Poids du colis en kg (lu sur l'étiquette ou saisi). */
  poids: z.number().positive().max(POIDS_MAX_KG).nullable().optional(),
});

/**
 * Ajoute un colis à la tournée du jour. Un colis déjà scanné est ignoré ;
 * un colis pour une adresse déjà présente rejoint cet arrêt (compteur de
 * colis) au lieu de créer un arrêt en double.
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Adresse manquante ou trop courte." }, { status: 400 });
  const run = await tourneeParId(supabase, appUser, parsed.data.run_id);
  if (!run) return NextResponse.json({ error: "Tournée introuvable." }, { status: 404 });
  let listId = parsed.data.list_id ?? null;
  if (listId && !(await listeDeLaTournee(supabase, run.id, listId))) return NextResponse.json({ error: "Liste introuvable dans cette tournée." }, { status: 400 });

  // Par défaut, GODAC range chaque adresse dans la liste de sa commune.
  // Une liste existante est réutilisée ; sinon elle est créée à la volée.
  const village = communeDepuisAdresse(parsed.data.adresse);
  if (village) {
    const { data: listes } = await supabase.from("delivery_lists").select("id, name, position").eq("run_id", run.id).order("position");
    const existante = (listes ?? []).find((l) => l.name.trim().toLocaleLowerCase("fr-FR") === village.toLocaleLowerCase("fr-FR"));
    if (existante) {
      listId = existante.id;
    } else {
      const positionListe = (listes ?? []).reduce((max, l) => Math.max(max, l.position), -1) + 1;
      const { data: creee, error: erreurListe } = await supabase.from("delivery_lists").insert({
        organization_id: appUser.organization_id,
        run_id: run.id,
        name: village.slice(0, 60),
        position: positionListe,
      }).select("id").single();
      if (erreurListe) return NextResponse.json({ error: `Impossible de créer la liste du village : ${erreurListe.message}` }, { status: 500 });
      listId = creee.id;
    }
  }

  const { data: stops } = await supabase.from("delivery_stops").select("id, list_id, kind, parcel_code, parcel_count, address, phone, status, position, weight_kg").eq("run_id", run.id);
  const code = parsed.data.code || null;
  const pays = await codePays(appUser.organization_id);
  const telephone = normaliserTelephone(parsed.data.telephone, pays);
  const poids = lirePoids(parsed.data.poids ?? null);
  if (code && (stops ?? []).some((s) => s.parcel_code?.split(",").includes(code))) {
    return NextResponse.json({ duplicate: true, message: "Colis déjà dans la tournée." });
  }

  const cle = cleAdresse(parsed.data.adresse);
  const kind = parsed.data.type ?? "livraison";
  // Regroupement seulement dans la même liste et pour le même type : une
  // ramasse et une livraison à la même adresse restent deux arrêts.
  const memeAdresse = (stops ?? []).find(
    (s) => s.status === "pending" && (s.list_id ?? null) === listId && typeArret(s.kind) === kind && cleAdresse(s.address) === cle,
  );
  if (memeAdresse) {
    const codes = [memeAdresse.parcel_code, code].filter(Boolean).join(",") || null;
    const { data } = await supabase
      .from("delivery_stops")
      .update({
        parcel_count: memeAdresse.parcel_count + 1,
        parcel_code: codes,
        ...(telephone && !memeAdresse.phone ? { phone: telephone } : {}),
        // Poids de l'arrêt = somme des colis dont le poids est connu.
        ...(poids ? { weight_kg: lirePoids(Number(memeAdresse.weight_kg ?? 0) + poids) } : {}),
      })
      .eq("id", memeAdresse.id)
      .select(STOP_FIELDS)
      .single();
    return NextResponse.json({ stop: data, grouped: true });
  }

  const geo = await geocodeAddress(parsed.data.adresse, pays);
  const position = (stops ?? []).reduce((m, s) => Math.max(m, s.position), -1) + 1;
  const { data, error } = await supabase
    .from("delivery_stops")
    .insert({
      organization_id: appUser.organization_id,
      run_id: run.id,
      ...(listId ? { list_id: listId } : {}),
      position,
      ...(kind !== "livraison" ? { kind } : {}),
      parcel_code: code,
      address: parsed.data.adresse,
      recipient: parsed.data.destinataire || null,
      phone: telephone,
      ...(poids ? { weight_kg: poids } : {}),
      lat: geo?.lat ?? null,
      lng: geo?.lng ?? null,
    })
    .select(STOP_FIELDS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ stop: data, geocoded: Boolean(geo) });
}
