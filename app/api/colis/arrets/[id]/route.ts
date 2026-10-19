import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { geocodeAddress } from "@/lib/geo/geocode";
import { codePays } from "@/lib/pays/serveur";
import { normaliserTelephone } from "@/lib/colis/telephone";
import { listeDeLaTournee, moduleActif, STOP_FIELDS } from "@/lib/colis/serveur";
import { ecrireHeure, lireHeure } from "@/lib/colis/horaires";
import { POIDS_MAX_KG, lirePoids } from "@/lib/colis/poids";
import { MOTIFS_ECHEC, libelleMotif, refusCloture } from "@/lib/colis/cloture";

const patchSchema = z.object({
  status: z.enum(["pending", "delivered", "failed"]).optional(),
  /** Échec : motif (« absent », « adresse_introuvable »…) et précision facultative, ajoutée aux consignes. */
  motif: z.enum(MOTIFS_ECHEC.map((m) => m.key) as [string, ...string[]]).optional(),
  precision: z.string().trim().max(200).nullable().optional(),
  /** Tournée attendue : l'arrêt doit lui appartenir (clôture depuis la liste). */
  run_id: z.string().uuid().optional(),
  /** Livraison ou ramasse (enlèvement chez un expéditeur). */
  type: z.enum(["livraison", "ramasse", "point_relais"]).optional(),
  /** Poids des colis de l'arrêt en kg ; null : poids inconnu. */
  poids: z.number().positive().max(POIDS_MAX_KG).nullable().optional(),
  adresse: z.string().trim().min(5).max(300).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  destinataire: z.string().trim().max(120).nullable().optional(),
  telephone: z.string().trim().max(40).nullable().optional(),
  parcel_count: z.number().int().min(1).max(500).optional(),
  packages_picked_up: z.number().int().min(0).max(500).nullable().optional(),
  /** Nombre effectivement déposé au point relais (0 à 500). */
  packages_delivered: z.number().int().min(0).max(500).nullable().optional(),
  /** Fait passer l'arrêt avant / après son voisin encore à livrer. */
  deplacer: z.enum(["haut", "bas"]).optional(),
  /** Range l'arrêt dans une autre liste de la même tournée (en fin de liste). */
  list_id: z.string().uuid().optional(),
  /**
   * Créneau ponctuel pour aujourd'hui (« avant 10 h » : fin seule) ;
   * prioritaire sur les horaires de l'annuaire. null : retirer le créneau.
   */
  creneau: z
    .object({ debut: z.string().nullable(), fin: z.string().nullable() })
    .refine((c) => (c.debut === null || lireHeure(c.debut) !== null) && (c.fin === null || lireHeure(c.fin) !== null), "Heure invalide")
    .refine((c) => c.debut !== null || c.fin !== null, "Créneau vide")
    .refine((c) => c.debut === null || c.fin === null || lireHeure(c.debut)! < lireHeure(c.fin)!, "Créneau incohérent")
    .nullable()
    .optional(),
});

/** Livré / échec / type (livraison, ramasse ou point relais) / adresse corrigée (re-géocodée). RLS : le chauffeur de la tournée ou l'encadrement. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const { adresse, status, motif, precision, run_id, type, poids, notes, destinataire, telephone, parcel_count, packages_picked_up, packages_delivered, deplacer, list_id, creneau } = parsed.data;

  if (list_id) {
    const { data: stop } = await supabase.from("delivery_stops").select("id, run_id, list_id, organization_id").eq("id", id).eq("organization_id", appUser.organization_id).maybeSingle();
    if (!stop) return NextResponse.json({ error: "Arrêt introuvable." }, { status: 404 });
    if (stop.list_id === list_id) return NextResponse.json({ ok: true });
    if (!(await listeDeLaTournee(supabase, stop.run_id, list_id))) return NextResponse.json({ error: "Liste introuvable dans cette tournée." }, { status: 400 });
    const { data: dernier } = await supabase.from("delivery_stops").select("position").eq("run_id", stop.run_id).order("position", { ascending: false }).limit(1).maybeSingle();
    const { data: moved, error } = await supabase
      .from("delivery_stops")
      .update({ list_id, position: (dernier?.position ?? 0) + 1 })
      .eq("id", id).eq("organization_id", appUser.organization_id)
      .select("id, run_id, list_id, position").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await journaliserArret(supabase, {
      organization_id: appUser.organization_id, run_id: moved.run_id, stop_id: moved.id, actor_id: appUser.id,
      event_type: "list_changed", new_value: { list_id: moved.list_id, position: moved.position },
      details: "Arrêt déplacé dans une autre liste de la tournée",
    });
    return NextResponse.json({ ok: true });
  }

  if (deplacer) {
    const { data: stop } = await supabase.from("delivery_stops").select("id, run_id, list_id, position").eq("id", id).eq("organization_id", appUser.organization_id).maybeSingle();
    if (!stop) return NextResponse.json({ error: "Arrêt introuvable." }, { status: 404 });
    // Voisin encore à livrer dans la même liste.
    let q = supabase.from("delivery_stops").select("id, position").eq("run_id", stop.run_id).eq("status", "pending");
    q = stop.list_id ? q.eq("list_id", stop.list_id) : q.is("list_id", null);
    const { data: voisins } = await q.order("position");
    const liste = voisins ?? [];
    const i = liste.findIndex((v) => v.id === id);
    const j = deplacer === "haut" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= liste.length) return NextResponse.json({ ok: true });
    const autre = liste[j]!;
    const { error: firstError } = await supabase.from("delivery_stops").update({ position: autre.position }).eq("id", id).eq("organization_id", appUser.organization_id);
    const { error: secondError } = await supabase.from("delivery_stops").update({ position: stop.position }).eq("id", autre.id).eq("organization_id", appUser.organization_id);
    if (firstError || secondError) return NextResponse.json({ error: "Réorganisation impossible." }, { status: 500 });
    await journaliserArret(supabase, {
      organization_id: appUser.organization_id, run_id: stop.run_id, stop_id: id, actor_id: appUser.id,
      event_type: "reordered", previous_value: { position: stop.position }, new_value: { position: autre.position },
      details: `Ordre de tournée modifié (${deplacer === "haut" ? "remonté" : "descendu"} d'un rang)`,
    });
    return NextResponse.json({ ok: true });
  }

  const update: Record<string, unknown> = {};
  if (destinataire !== undefined) update.recipient = destinataire || null;
  if (parcel_count !== undefined) update.parcel_count = parcel_count;
  if (packages_picked_up !== undefined) update.packages_picked_up = packages_picked_up;
  if (packages_delivered !== undefined) update.packages_delivered = packages_delivered;
  if (telephone !== undefined) {
    const tel = normaliserTelephone(telephone, await codePays(appUser.organization_id));
    if (telephone && !tel) return NextResponse.json({ error: "Numéro de téléphone non reconnu." }, { status: 400 });
    update.phone = tel;
  }
  let previousStatus: string | null = null;
  if (status) {
    // Clôture dans n'importe quel ordre, mais pas deux fois ; annulation seulement d'un arrêt clôturé.
    let q = supabase.from("delivery_stops").select("id, status, notes").eq("id", id).eq("organization_id", appUser.organization_id);
    if (run_id) q = q.eq("run_id", run_id);
    const { data: actuel } = await q.maybeSingle();
    if (!actuel) return NextResponse.json({ error: run_id ? "Arrêt introuvable dans cette tournée." : "Arrêt introuvable." }, { status: 404 });
    const refus = refusCloture(actuel.status, status);
    if (refus) return NextResponse.json({ error: refus }, { status: 409 });
    previousStatus = actuel.status;
    update.status = status;
    update.done_at = status === "pending" ? null : new Date().toISOString();
    if (status !== "delivered") Object.assign(update, { delivered_place: null, proof_code: null });
    update.failure_reason = status === "failed" ? (motif ?? "absent") : null;
    if (status === "failed" && precision) {
      update.notes = [actuel.notes, `${libelleMotif(motif ?? "absent")} : ${precision}`].filter(Boolean).join(" · ").slice(0, 500);
    }
  }
  if (type) update.kind = type;
  if (poids !== undefined) update.weight_kg = poids === null ? null : lirePoids(poids);
  if (notes !== undefined) update.notes = notes;
  if (creneau !== undefined) {
    const heure = (v: string | null | undefined) => (v ? ecrireHeure(lireHeure(v)!) : null);
    Object.assign(update, { window_start: heure(creneau?.debut), window_end: heure(creneau?.fin) });
  }
  if (adresse) {
    const geo = await geocodeAddress(adresse, await codePays(appUser.organization_id));
    Object.assign(update, { address: adresse, lat: geo?.lat ?? null, lng: geo?.lng ?? null });
  }
  let maj = supabase.from("delivery_stops").update(update).eq("id", id).eq("organization_id", appUser.organization_id);
  // Garde contre deux clôtures simultanées (deux téléphones, double appui).
  if (status) maj = status === "pending" ? maj.neq("status", "pending") : maj.eq("status", "pending");
  const { data, error } = await maj.select(`${STOP_FIELDS}, run_id`).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: status ? "Arrêt déjà clôturé ou modifié entre-temps : actualisez." : "Arrêt introuvable." }, { status: status ? 409 : 404 });
  const events: Record<string, unknown>[] = [];
  if (status && previousStatus !== null && previousStatus !== status) {
    const eventType = status === "delivered" ? "delivered" : status === "failed" ? "failed" : "reopened";
    events.push({
      organization_id: appUser.organization_id, run_id: data.run_id, stop_id: data.id, actor_id: appUser.id,
      event_type: eventType, previous_value: { status: previousStatus }, new_value: { status },
      details: status === "delivered" ? "Livraison / ramasse effectuée" : status === "failed" ? "Échec de livraison" : "Arrêt rouvert",
    });
    events.push({
      organization_id: appUser.organization_id, run_id: data.run_id, stop_id: data.id, actor_id: appUser.id,
      event_type: "status_changed", previous_value: { status: previousStatus }, new_value: { status },
      details: `Statut modifié : ${previousStatus} → ${status}`,
    });
  }
  if (packages_delivered !== undefined) events.push({
    organization_id: appUser.organization_id, run_id: data.run_id, stop_id: data.id, actor_id: appUser.id,
    event_type: "delivery_count_recorded", new_value: { packages_delivered },
    details: `Nombre réel de colis déposés enregistré : ${packages_delivered ?? "inconnu"}`,
  });
  if (packages_picked_up !== undefined) events.push({
    organization_id: appUser.organization_id, run_id: data.run_id, stop_id: data.id, actor_id: appUser.id,
    event_type: "pickup_count_recorded", new_value: { packages_picked_up },
    details: `Nombre réel de colis ramassés enregistré : ${packages_picked_up ?? "inconnu"}`,
  });
  if (events.length) await journaliserArret(supabase, events);
  return NextResponse.json({ stop: data });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const { id } = await params;
  const { data: stop } = await supabase.from("delivery_stops")
    .select("id, run_id").eq("id", id).eq("organization_id", appUser.organization_id).maybeSingle();
  if (!stop) return NextResponse.json({ error: "Arrêt introuvable." }, { status: 404 });
  const { data: run } = await supabase.from("delivery_runs")
    .select("id, status").eq("id", stop.run_id).eq("organization_id", appUser.organization_id).maybeSingle();
  if (!run) return NextResponse.json({ error: "Tournée introuvable." }, { status: 404 });
  if (run.status === "done") return NextResponse.json({ error: "Une tournée clôturée est conservée dans l'historique." }, { status: 409 });
  const { error } = await supabase.from("delivery_stops").delete().eq("id", id).eq("organization_id", appUser.organization_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/**
 * Historique d'arrêt (delivery_stop_events) : non bloquant. L'arrêt est
 * déjà enregistré quand on écrit l'historique ; un échec (table absente,
 * RLS…) est journalisé côté serveur sans faire échouer la requête, pour
 * que le chauffeur ne retente pas une modification déjà faite (audit E7).
 */
async function journaliserArret(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, events: Record<string, unknown> | Record<string, unknown>[]) {
  const { error } = await supabase.from("delivery_stop_events").insert(events);
  if (error) console.error("delivery_stop_events (non bloquant)", error.message);
}
