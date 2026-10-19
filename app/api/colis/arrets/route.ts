import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { geocodeAddress } from "@/lib/geo/geocode";
import { codePays } from "@/lib/pays/serveur";
import { normaliserTelephone } from "@/lib/colis/telephone";
import { TYPES_ARRET, typeArret, type TypeArret } from "@/lib/colis/livraison";
import { NOM_RELAIS_MAX, arretARejoindre, normaliserNomRelais, typeApresRegroupement } from "@/lib/colis/relais";
import { POIDS_MAX_KG, lirePoids } from "@/lib/colis/poids";
import { cleAdresse, horairesDesAdresses, listeDeLaTournee, moduleActif, tourneeParId, STOP_FIELDS } from "@/lib/colis/serveur";

const bodySchema = z.object({
  run_id: z.string().uuid(),
  /** Liste de la tournée où ranger le colis (sinon la liste implicite). */
  list_id: z.string().uuid().nullable().optional(),
  code: z.string().trim().max(120).nullable().optional(),
  adresse: z.string().trim().min(5).max(300),
  destinataire: z.string().trim().max(120).nullable().optional(),
  telephone: z.string().trim().max(40).nullable().optional(),
  /** Livraison (par défaut), ramasse ou point relais. */
  type: z.enum(TYPES_ARRET.map((t) => t.key) as [TypeArret, ...TypeArret[]]).optional(),
  /** Point relais : nom du relais (Relais Colis, Pickup, Mondial Relay…). */
  relais: z.string().max(NOM_RELAIS_MAX * 2).nullable().optional(),
  /** Nombre de colis de l'arrêt (point relais : colis à déposer) ; 1 par défaut. */
  colis: z.number().int().min(1).max(500).optional(),
  /** Poids du colis en kg (lu sur l'étiquette ou saisi). */
  poids: z.number().positive().max(POIDS_MAX_KG).nullable().optional(),
});

/**
 * Ajoute un colis à la tournée du jour. Un colis déjà scanné est ignoré ;
 * un colis pour une adresse déjà présente rejoint cet arrêt (compteur de
 * colis) au lieu de créer un arrêt en double — y compris un arrêt point
 * relais à cette adresse (lib/colis/relais.ts). Un point relais reprend le
 * nom de l'annuaire des adresses pro quand il n'est pas saisi.
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Adresse manquante ou trop courte." }, { status: 400 });
  const run = await tourneeParId(supabase, appUser, parsed.data.run_id);
  if (!run) return NextResponse.json({ error: "Tournée introuvable." }, { status: 404 });
  const listId = parsed.data.list_id ?? null;
  if (listId && !(await listeDeLaTournee(supabase, run.id, listId))) return NextResponse.json({ error: "Liste introuvable dans cette tournée." }, { status: 400 });

  const { data: stops } = await supabase.from("delivery_stops").select("id, list_id, kind, parcel_code, parcel_count, address, phone, status, position, weight_kg, relay_name").eq("run_id", run.id);
  const code = parsed.data.code || null;
  const pays = await codePays(appUser.organization_id);
  const telephone = normaliserTelephone(parsed.data.telephone, pays);
  const poids = lirePoids(parsed.data.poids ?? null);
  if (code && (stops ?? []).some((s) => s.parcel_code?.split(",").includes(code))) {
    return NextResponse.json({ duplicate: true, message: "Colis déjà dans la tournée." });
  }

  const cle = cleAdresse(parsed.data.adresse);
  const kind: TypeArret = parsed.data.type ?? "livraison";
  const nombre = parsed.data.colis ?? 1;
  let relais = kind === "point_relais" ? normaliserNomRelais(parsed.data.relais) : null;
  // Point relais : son nom et ses horaires viennent de l'annuaire des adresses pro s'il y figure.
  let horaires = false;
  if (kind === "point_relais") {
    const fiche = (await horairesDesAdresses(supabase, appUser.organization_id, [parsed.data.adresse]).catch(() => new Map())).get(cle);
    horaires = Boolean(fiche);
    relais ??= normaliserNomRelais(fiche?.label);
  }

  // Regroupement seulement dans la même liste et pour un type compatible :
  // une ramasse et une livraison à la même adresse restent deux arrêts ;
  // les colis adressés à un relais rejoignent l'arrêt point relais.
  const memeAdresse = arretARejoindre(
    (stops ?? []).map((s) => ({ ...s, cle: cleAdresse(s.address) })),
    { listId, cle, type: kind },
  );
  if (memeAdresse) {
    const codes = [memeAdresse.parcel_code, code].filter(Boolean).join(",") || null;
    const typeFinal = typeApresRegroupement(typeArret(memeAdresse.kind), kind) ?? typeArret(memeAdresse.kind);
    const { data } = await supabase
      .from("delivery_stops")
      .update({
        parcel_count: Math.min(500, memeAdresse.parcel_count + nombre),
        parcel_code: codes,
        ...(telephone && !memeAdresse.phone ? { phone: telephone } : {}),
        // Poids de l'arrêt = somme des colis dont le poids est connu.
        ...(poids ? { weight_kg: lirePoids(Number(memeAdresse.weight_kg ?? 0) + poids) } : {}),
        ...(typeFinal !== typeArret(memeAdresse.kind) ? { kind: typeFinal } : {}),
        ...(relais && relais !== memeAdresse.relay_name ? { relay_name: relais } : {}),
      })
      .eq("id", memeAdresse.id)
      .select(STOP_FIELDS)
      .single();
    return NextResponse.json({ stop: data, grouped: true, relais: typeFinal === "point_relais", ...(kind === "point_relais" ? { horaires } : {}) });
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
      ...(relais ? { relay_name: relais } : {}),
      ...(nombre > 1 ? { parcel_count: nombre } : {}),
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
  return NextResponse.json({ stop: data, geocoded: Boolean(geo), ...(kind === "point_relais" ? { horaires } : {}) });
}
