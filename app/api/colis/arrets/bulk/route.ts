import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { geocodeAddressDetail, reverseGeocode } from "@/lib/geo/geocode";
import { codePays } from "@/lib/pays/serveur";
import { normaliserTelephone } from "@/lib/colis/telephone";
import { cleAdresse, horairesDesAdresses, listeDeLaTournee, materialiserListePrincipale, moduleActif, tourneeParId, LIST_FIELDS } from "@/lib/colis/serveur";
import { chargerContexteRangement, listePourAdresse } from "@/lib/colis/villages-serveur";
import { TYPES_ARRET, typeArret, type TypeArret } from "@/lib/colis/livraison";
import { typeApresRegroupement } from "@/lib/colis/relais";
import { POIDS_MAX_KG, lirePoids } from "@/lib/colis/poids";
import { jourIso } from "@/lib/colis/heure-paris";
import { MESSAGE_TOURNEE_CLOTUREE } from "@/lib/colis/cloture";
import { erreurCreneau } from "@/lib/colis/creneau";

const HEURE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const pointSchema = z.object({
  adresse: z.string().trim().max(300).nullable(),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
  nom: z.string().trim().max(120).nullable(),
  telephone: z.string().trim().max(40).nullable().optional(),
  // Champs du bordereau de tournée (lib/colis/bordereau.ts), facultatifs :
  // une liste importée (Google Maps, fichier) n'en a aucun.
  /** N° de colis (plusieurs séparés par des virgules) : un colis déjà dans la fiche est ignoré. */
  code: z.string().trim().max(1000).nullable().optional(),
  type: z.enum(TYPES_ARRET.map((t) => t.key) as [TypeArret, ...TypeArret[]]).optional(),
  /** Nombre de colis de l'arrêt (1 par défaut ; 0 pour une ramasse). */
  colis: z.number().int().min(0).max(500).optional(),
  poids: z.number().positive().max(POIDS_MAX_KG).nullable().optional(),
  window_start: z.string().regex(HEURE).nullable().optional(),
  window_end: z.string().regex(HEURE).nullable().optional(),
  /** Horaires d'ouverture du jour (pause de midi) : fiche horaires pro si l'adresse n'en a pas. */
  plages: z.array(z.object({ debut: z.string().regex(HEURE), fin: z.string().regex(HEURE) })).max(2).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  /** Nom de la société (business_name). */
  societe: z.string().trim().max(200).nullable().optional(),
  /** Commune et code postal connus (bordereau) : rangement par village sans attendre le géocodage. */
  commune: z.string().trim().max(120).nullable().optional(),
  code_postal: z.string().trim().max(10).nullable().optional(),
}).superRefine((p, ctx) => {
  // Créneau du jour (modifiable dans l'aperçu du bordereau) : mêmes règles que l'ajout unitaire.
  if (!p.window_start && !p.window_end) return;
  const erreur = erreurCreneau({ debut: p.window_start ?? null, fin: p.window_end ?? null });
  if (erreur) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["window_end"], message: erreur });
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
  /** Import du bordereau de tournée (tout transporteur) : gardé pour le rapprochement (migration 20261025000002). */
  bordereau: z
    .object({
      numero: z.string().trim().min(1).max(40),
      tournee: z.string().trim().max(40).nullable(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      pages: z.array(z.number().int().positive().max(999)).max(200),
      colis: z.number().int().min(0).max(100_000),
      poids_kg: z.number().min(0).max(1_000_000),
      total_colis: z.number().int().min(0).max(100_000).nullable(),
      total_poids_kg: z.number().min(0).max(1_000_000).nullable(),
    })
    .nullable()
    .optional(),
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
  if (!parsed.success) {
    const creneauRefuse = parsed.error.issues.find((i) => i.code === "custom" && i.path.includes("window_end"));
    if (creneauRefuse) return NextResponse.json({ error: `Arrêt n° ${Number(creneauRefuse.path[1]) + 1} : ${creneauRefuse.message}` }, { status: 400 });
    return NextResponse.json({ error: "Liste invalide (200 adresses au plus)." }, { status: 400 });
  }
  const run = await tourneeParId(supabase, appUser, parsed.data.run_id);
  if (!run) return NextResponse.json({ error: "Tournée introuvable." }, { status: 404 });
  if (run.status === "done") return NextResponse.json({ error: MESSAGE_TOURNEE_CLOTUREE }, { status: 409 });
  let listId = parsed.data.list_id ?? null;
  if (listId && !(await listeDeLaTournee(supabase, run.id, listId))) return NextResponse.json({ error: "Liste introuvable dans cette tournée." }, { status: 400 });

  // Hors de France, OpenStreetMap (Nominatim) demande une requête à la fois.
  const pays = await codePays(appUser.organization_id);
  const complets = await parLots(parsed.data.points, pays === "FR" ? 6 : 1, async (p) => {
    // Nominatim : une requête par seconde au plus (conditions d'utilisation d'OpenStreetMap).
    if (pays !== "FR") await new Promise((r) => setTimeout(r, 1000));
    let { adresse, lat, lng } = p;
    let commune: string | null = p.commune ?? null;
    let codePostal: string | null = p.code_postal ?? null;
    if ((lat === null || lng === null) && adresse) {
      const geo = await geocodeAddressDetail(adresse, pays);
      lat = geo?.lat ?? null;
      lng = geo?.lng ?? null;
      commune = geo?.city ?? commune;
      codePostal = geo?.postcode ?? codePostal;
    }
    if (!adresse && lat !== null && lng !== null) adresse = (await reverseGeocode(lat, lng, pays)) ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    return adresse && adresse.length >= 3
      ? {
          adresse,
          lat,
          lng,
          commune,
          codePostal,
          nom: p.nom,
          telephone: normaliserTelephone(p.telephone, pays),
          codes: (p.code ?? "").split(",").map((c) => c.trim()).filter(Boolean),
          type: (p.type ?? "livraison") as TypeArret,
          colis: p.colis ?? 1,
          poids: lirePoids(p.poids ?? null),
          window_start: p.window_start ?? null,
          window_end: p.window_end ?? null,
          plages: p.plages?.length ? p.plages : null,
          notes: p.notes || null,
          societe: p.societe || null,
        }
      : null;
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

  const { data: existants } = await supabase.from("delivery_stops").select("id, list_id, kind, address, parcel_code, parcel_count, phone, status, position, weight_kg").eq("run_id", run.id);
  // Un colis déjà dans la fiche (scanné, ou bordereau importé deux fois) n'est pas ajouté une seconde fois.
  const codesConnus = new Set((existants ?? []).flatMap((s) => (s.parcel_code ?? "").split(",").map((c: string) => c.trim()).filter(Boolean)));
  // Regroupement par commune/liste ET adresse : un même lieu ne crée pas deux
  // arrêts — sauf types incompatibles (une ramasse et une livraison à la même
  // adresse restent deux arrêts, lib/colis/relais.ts).
  const famille = (t: TypeArret) => (t === "ramasse" ? "R" : "L");
  const parCle = new Map((existants ?? []).filter((s) => s.status === "pending").map((s) => [`${s.list_id ?? ""}|${cleAdresse(s.address)}|${famille(typeArret(s.kind))}`, s]));
  let position = (existants ?? []).reduce((m, s) => Math.max(m, s.position), -1) + 1;
  const nouveaux = new Map<string, Record<string, unknown>>();
  const societes = new Map<number, string>();
  const plagesPro = new Map<string, { adresse: string; nom: string | null; plages: { debut: string; fin: string }[] }>();
  let regroupes = 0;
  let ignores = 0;
  let doublons = 0;

  for (const [k, p] of complets.entries()) {
    if (!p) {
      ignores++;
      continue;
    }
    const codes = p.codes.filter((c) => !codesConnus.has(c));
    if (p.codes.length && !codes.length) {
      doublons++;
      continue;
    }
    for (const c of codes) codesConnus.add(c);
    const listePoint = listeDe.get(k) ?? null;
    const cle = `${listePoint ?? ""}|${cleAdresse(p.adresse)}|${famille(p.type)}`;
    const existant = parCle.get(cle);
    const nouveau = nouveaux.get(cle);
    const ajout = p.type === "ramasse" ? 0 : p.colis;
    const code = (precedent: string | null | undefined) => [precedent, ...codes].filter(Boolean).join(",").slice(0, 2000) || null;
    if (p.plages && p.type !== "point_relais") plagesPro.set(cleAdresse(p.adresse), { adresse: p.adresse, nom: p.societe ?? p.nom, plages: p.plages });
    if (existant) {
      regroupes++;
      const typeFinal = typeApresRegroupement(typeArret(existant.kind), p.type) ?? typeArret(existant.kind);
      existant.parcel_count = Math.min(500, existant.parcel_count + ajout);
      if (!existant.phone && p.telephone) existant.phone = p.telephone;
      existant.parcel_code = codes.length ? code(existant.parcel_code) : existant.parcel_code;
      const poids = p.poids ? lirePoids(Number(existant.weight_kg ?? 0) + p.poids) : null;
      await supabase
        .from("delivery_stops")
        .update({
          parcel_count: existant.parcel_count,
          phone: existant.phone,
          ...(codes.length ? { parcel_code: existant.parcel_code } : {}),
          ...(poids ? { weight_kg: (existant.weight_kg = poids) } : {}),
          ...(typeFinal !== typeArret(existant.kind) ? { kind: (existant.kind = typeFinal) } : {}),
        })
        .eq("id", existant.id);
    } else if (nouveau) {
      regroupes++;
      nouveau.parcel_count = Math.min(500, (nouveau.parcel_count as number) + ajout);
      if (!nouveau.phone && p.telephone) nouveau.phone = p.telephone;
      if (codes.length) nouveau.parcel_code = code(nouveau.parcel_code as string | null);
      if (p.poids) nouveau.weight_kg = lirePoids(Number(nouveau.weight_kg ?? 0) + p.poids);
      const typeFinal = typeApresRegroupement(typeArret(nouveau.kind as string | undefined), p.type);
      if (typeFinal && typeFinal !== "livraison") nouveau.kind = typeFinal;
      if (p.notes && !String(nouveau.notes ?? "").includes(p.notes)) nouveau.notes = [nouveau.notes, p.notes].filter(Boolean).join(" · ").slice(0, 1000);
    } else {
      if (p.societe) societes.set(position, p.societe);
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
        // Une ramasse est un arrêt, pas un colis (même règle que l'ajout unitaire).
        parcel_count: ajout,
        // `kind` est toujours posé : dans une insertion groupée, PostgREST met à
        // null les colonnes absentes d'une ligne dès qu'une autre ligne les porte
        // (relais + livraisons dans le même import) → violation de not-null.
        kind: p.type,
        // Autres colonnes posées seulement quand le point les porte.
        ...(codes.length ? { parcel_code: code(null) } : {}),
        ...(p.poids ? { weight_kg: p.poids } : {}),
        ...(p.window_start ? { window_start: p.window_start } : {}),
        ...(p.window_end ? { window_end: p.window_end } : {}),
        ...(p.notes ? { notes: p.notes } : {}),
      });
    }
  }

  if (nouveaux.size) {
    const { data: crees, error } = await supabase.from("delivery_stops").insert([...nouveaux.values()]).select("id, position");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    // Société détectée (migration 190) : posée après coup, sans bloquer l'import si la colonne manque.
    for (const s of crees ?? []) {
      const nom = societes.get(s.position);
      if (nom) await supabase.from("delivery_stops").update({ business_name: nom }).eq("id", s.id).then(() => undefined, () => undefined);
    }
  }
  // Horaires d'ouverture lus (pause de midi) : fiche horaires pro pour le
  // jour de la tournée, seulement si l'adresse n'en a pas encore — une
  // fiche existante (saisie ou trouvée sur internet) n'est jamais écrasée.
  let horairesPro = 0;
  if (plagesPro.size) {
    const connues = await horairesDesAdresses(supabase, appUser.organization_id, [...plagesPro.values()].map((h) => h.adresse)).catch(() => null);
    if (connues) {
      const jour = String(jourIso(run.run_date));
      for (const [cle, h] of plagesPro) {
        if (connues.has(cle)) continue;
        const { error } = await supabase.from("delivery_address_hours").insert({
          organization_id: appUser.organization_id,
          address_key: cle,
          label: h.nom?.slice(0, 200) ?? null,
          address: h.adresse,
          weekly_schedule: { [jour]: h.plages.map((pl) => ({ open: pl.debut, close: pl.fin })) },
          notes: "Horaires lus sur le bordereau de tournée.",
          updated_by: appUser.id,
        });
        if (!error) horairesPro++;
      }
    }
  }
  if (parsed.data.bordereau) await enregistrerBordereau(supabase, appUser.organization_id, run.id, parsed.data.bordereau);
  const sansGps = [...nouveaux.values()].filter((s) => s.lat === null).length;
  // Nouvelles adresses avant le départ : l'ordre est à recalculer (fait au lancement).
  if (nouveaux.size && run.status === "loading" && run.optimized_at) await supabase.from("delivery_runs").update({ optimized_at: null }).eq("id", run.id);
  return NextResponse.json({ ajoutes: nouveaux.size, regroupes, ignores, doublons, horairesPro, sansGps, list_id: listId });
}

/**
 * N° de bordereau de la fiche, pages lues, colis et poids, pour le
 * rapprochement ultérieur (table delivery_run_bordereaux). Migration non
 * appliquée : ignoré sans bloquer l'import.
 */
async function enregistrerBordereau(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  organizationId: string,
  runId: string,
  b: NonNullable<z.infer<typeof bodySchema>["bordereau"]>,
) {
  const { error } = await supabase.from("delivery_run_bordereaux").upsert(
    {
      organization_id: organizationId,
      run_id: runId,
      numero: b.numero,
      tour_number: b.tournee,
      bordereau_date: b.date,
      pages_read: [...new Set(b.pages)].sort((x, y) => x - y),
      parcels: b.colis,
      weight_kg: b.poids_kg,
      total_parcels: b.total_colis,
      total_weight_kg: b.total_poids_kg,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "run_id,numero" },
  );
  if (error) console.error("bulk: bordereau non enregistré (migration 20261025000002 appliquée ?)", error.message);
}
