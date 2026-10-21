import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { geocodeAddressDetail, type GeocodeDetail } from "@/lib/geo/geocode";
import { codePays } from "@/lib/pays/serveur";
import { normaliserTelephone } from "@/lib/colis/telephone";
import { TYPES_ARRET, typeArret, type TypeArret } from "@/lib/colis/livraison";
import { NOM_RELAIS_MAX, arretARejoindre, normaliserNomRelais, typeApresRegroupement } from "@/lib/colis/relais";
import { POIDS_MAX_KG, lirePoids } from "@/lib/colis/poids";
import { cleAdresse, horairesDesAdresses, listeDeLaTournee, moduleActif, tourneeParId, STOP_FIELDS } from "@/lib/colis/serveur";
import { listePourAdresse } from "@/lib/colis/villages-serveur";
import { detecterProfessionnel } from "@/lib/colis/professionnel";
import { MESSAGE_TOURNEE_CLOTUREE } from "@/lib/colis/cloture";
import { colonnesCreneau, schemaCreneau } from "@/lib/colis/creneau";

const bodySchema = z.object({
  run_id: z.string().uuid(),
  /** Liste choisie par le chauffeur ; absente : rangement automatique par village (lib/colis/villages.ts). */
  list_id: z.string().uuid().nullable().optional(),
  code: z.string().trim().max(120).nullable().optional(),
  adresse: z.string().trim().min(5).max(300),
  destinataire: z.string().trim().max(120).nullable().optional(),
  telephone: z.string().trim().max(40).nullable().optional(),
  /** Livraison (par défaut), ramasse ou point relais. */
  type: z.enum(TYPES_ARRET.map((t) => t.key) as [TypeArret, ...TypeArret[]]).optional(),
  /** Point relais : nom du relais (Relais Colis, Pickup, Mondial Relay…). */
  relais: z.string().max(NOM_RELAIS_MAX * 2).nullable().optional(),
  /** Point relais : nombre de colis à déposer (0 par défaut, les colis scannés à son adresse s'y ajoutent). */
  colis: z.number().int().min(0).max(500).optional(),
  /** Poids du colis en kg (lu sur l'étiquette ou saisi). */
  poids: z.number().positive().max(POIDS_MAX_KG).nullable().optional(),
  /** Une ramasse exceptionnelle ne devient pas une habitude quotidienne. */
  exceptionnelle: z.boolean().optional(),
  /**
   * Créneau ponctuel du jour choisi avant l'ajout (« avant 10 h » : fin
   * seule) ; mêmes format et règles que le PATCH (lib/colis/creneau.ts).
   * Absent ou null : pas de créneau (l'annuaire des horaires s'applique).
   */
  creneau: schemaCreneau.nullable().optional(),
  /**
   * Établissement choisi dans la recherche (annuaire, OpenStreetMap,
   * Google) : son nom devient business_name et ses coordonnées évitent un
   * géocodage approximatif de l'adresse.
   */
  etablissement: z
    .object({ nom: z.string().trim().min(1).max(200), lat: z.number().min(-90).max(90).nullable(), lng: z.number().min(-180).max(180).nullable() })
    .nullable()
    .optional(),
});

/**
 * Ajoute un colis à la tournée du jour. Un colis déjà scanné est ignoré ;
 * un colis pour une adresse déjà présente rejoint cet arrêt (compteur de
 * colis) au lieu de créer un arrêt en double — y compris un arrêt point
 * relais à cette adresse (lib/colis/relais.ts). Un point relais reprend le
 * nom de l'annuaire des adresses pro quand il n'est pas saisi.
 */
export async function POST(req: Request) {
  const g = await garderApi({ modules: ["route_optimizer"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    const creneauRefuse = parsed.error.issues.find((issue) => issue.path[0] === "creneau");
    if (creneauRefuse) return NextResponse.json({ error: creneauRefuse.message }, { status: 400 });
    const champs = parsed.error.issues.map((issue) => `${issue.path.join(".") || "requête"} : ${issue.message}`).join(" · ");
    return NextResponse.json({ error: `Impossible d’ajouter cet arrêt. Vérifiez les champs requis. ${champs}` }, { status: 400 });
  }
  const run = await tourneeParId(supabase, appUser, parsed.data.run_id);
  if (!run) return NextResponse.json({ error: "Tournée introuvable." }, { status: 404 });
  // Tournée clôturée : figée. En cours (in_progress) : le chauffeur peut
  // ajouter une adresse oubliée depuis GO Navigation.
  if (run.status === "done") return NextResponse.json({ error: MESSAGE_TOURNEE_CLOTUREE }, { status: 409 });
  let listId = parsed.data.list_id ?? null;
  if (listId && !(await listeDeLaTournee(supabase, run.id, listId))) return NextResponse.json({ error: "Liste introuvable dans cette tournée." }, { status: 400 });

  const { data: stops } = await supabase.from("delivery_stops").select("id, list_id, kind, parcel_code, parcel_count, address, phone, status, position, weight_kg, relay_name").eq("run_id", run.id);
  const pays = await codePays(appUser.organization_id);
  const cle = cleAdresse(parsed.data.adresse);
  const code = parsed.data.code || null;
  if (code && (stops ?? []).some((s) => s.parcel_code?.split(",").includes(code))) {
    return NextResponse.json({ duplicate: true, message: "Colis déjà dans la tournée." });
  }

  // Rangement automatique (aucune liste choisie) : une adresse déjà présente
  // garde sa liste ; sinon village de la tournée par commune ou proximité,
  // « Hors tournée » sinon (tournée sans villages : liste de la commune).
  let geo: GeocodeDetail | null | undefined;
  let rangement: Awaited<ReturnType<typeof listePourAdresse>> | null = null;
  if (!listId) {
    const deja = (stops ?? []).find((s) => s.status === "pending" && s.list_id && cleAdresse(s.address) === cle);
    if (deja) listId = deja.list_id;
    else {
      geo = await geocodeAddressDetail(parsed.data.adresse, pays);
      rangement = await listePourAdresse(supabase, appUser, run.id, {
        texte: parsed.data.adresse,
        commune: geo?.city,
        codePostal: geo?.postcode,
        point: geo ? { lat: geo.lat, lng: geo.lng } : null,
      });
      listId = rangement.listId;
    }
  }
  const village = rangement?.nom ? { nom: rangement.nom, horsTournee: rangement.raison === "hors_tournee" } : null;

  const telephone = normaliserTelephone(parsed.data.telephone, pays);
  // window_start / window_end posés dès la création : l'optimisation les respecte.
  const creneau = parsed.data.creneau ? colonnesCreneau(parsed.data.creneau) : null;
  const poids = lirePoids(parsed.data.poids ?? null);

  const kind: TypeArret = parsed.data.type ?? "livraison";
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
    const typeAvant = typeArret(memeAdresse.kind);
    const typeFinal = typeApresRegroupement(typeAvant, kind) ?? typeAvant;
    // Colis ajoutés : un colis à livrer, ou le nombre saisi pour un point relais.
    const ajout = kind === "livraison" ? 1 : kind === "point_relais" ? (parsed.data.colis ?? 0) : 0;
    const { data } = await supabase
      .from("delivery_stops")
      .update({
        ...(ajout ? { parcel_count: Math.min(500, memeAdresse.parcel_count + ajout) } : {}),
        ...(typeFinal !== typeAvant ? { kind: typeFinal } : {}),
        ...(relais && relais !== memeAdresse.relay_name ? { relay_name: relais } : {}),
        parcel_code: codes,
        ...(telephone && !memeAdresse.phone ? { phone: telephone } : {}),
        // Poids de l'arrêt = somme des colis dont le poids est connu.
        ...(poids ? { weight_kg: lirePoids(Number(memeAdresse.weight_kg ?? 0) + poids) } : {}),
        // Créneau choisi à l'ajout : il remplace celui de l'arrêt existant.
        ...(creneau ? creneau : {}),
      })
      .eq("id", memeAdresse.id)
      .select(STOP_FIELDS)
      .single();
    return NextResponse.json({ stop: data, grouped: true, relais: typeFinal === "point_relais", village, ...(kind === "point_relais" ? { horaires } : {}) });
  }

  if (geo === undefined) geo = await geocodeAddressDetail(parsed.data.adresse, pays);
  const etablissement = parsed.data.etablissement ?? null;
  const pointChoisi = etablissement && etablissement.lat !== null && etablissement.lng !== null ? { lat: etablissement.lat, lng: etablissement.lng } : null;
  // Adresse pro (forme juridique, mot-clé métier) : nom retenu sur l'arrêt ;
  // les horaires sont cherchés ensuite, sans bloquer l'ajout
  // (/api/colis/horaires/recherche, appelé par l'écran).
  const pro = kind === "ramasse" || kind === "point_relais" ? null : detecterProfessionnel({ destinataire: parsed.data.destinataire, adresse: parsed.data.adresse });
  const position = (stops ?? []).reduce((m, s) => Math.max(m, s.position), -1) + 1;
  const { data, error } = await supabase
    .from("delivery_stops")
    .insert({
      organization_id: appUser.organization_id,
      run_id: run.id,
      ...(listId ? { list_id: listId } : {}),
      position,
      ...(kind !== "livraison" ? { kind } : {}),
      ...(kind === "ramasse" ? { exceptional_pickup: parsed.data.exceptionnelle === true } : {}),
      parcel_code: code,
      // Une ramasse ou un point relais est un arrêt, pas un colis.
      // Le compteur de colis est renseigné seulement pour les livraisons réelles.
      // Point relais : nombre de colis à déposer saisi à la création.
      parcel_count: kind === "livraison" ? 1 : kind === "point_relais" ? (parsed.data.colis ?? 0) : 0,
      ...(relais ? { relay_name: relais } : {}),
      address: parsed.data.adresse,
      recipient: parsed.data.destinataire || null,
      phone: telephone,
      ...(poids ? { weight_kg: poids } : {}),
      ...(creneau ?? {}),
      lat: pointChoisi?.lat ?? geo?.lat ?? null,
      lng: pointChoisi?.lng ?? geo?.lng ?? null,
    })
    .select(STOP_FIELDS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const nomPro = etablissement?.nom ?? (pro?.pro ? pro.nom : null);
  if (nomPro) await supabase.from("delivery_stops").update({ business_name: nomPro.slice(0, 200) }).eq("id", data.id).then(() => undefined, () => undefined);
  // Nouvel arrêt avant le départ : l'ordre est à recalculer (fait au lancement).
  if (run.status === "loading" && run.optimized_at) await supabase.from("delivery_runs").update({ optimized_at: null }).eq("id", run.id);

  // Une ramasse ajoutée par le chauffeur reste limitée à cette tournée.
  // Les ramasses récurrentes sont gérées par la direction sur la fiche du village,
  // afin qu’elles soient communes à tous les chauffeurs qui desservent ce village.
  return NextResponse.json({
    stop: data,
    geocoded: Boolean(pointChoisi ?? geo),
    village,
    professionnel: nomPro,
    ...(kind === "point_relais" ? { horaires } : {}),
  });
}
