import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleAdresse } from "@/lib/colis/serveur";
import { minutesParis } from "@/lib/colis/heure-paris";
import { consignesDepuisNotes, dureeObservee, fusionnerObservation, retenirAdresse, type ObservationArret } from "@/lib/colis/fiche-client";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";

const CHAMPS_FICHE =
  "id, label, address, phone, recipient, access_notes, lat, lng, window_start, window_end, service_avg_min, service_samples, delivered_count, failed_count, success_by_hour, failure_reasons, contact_message_count, contact_phone_count, last_delivery_at";

/**
 * Met à jour la fiche client de l'adresse d'un arrêt qui vient d'être clôturé
 * (livré ou non livré) : téléphone, contact, consignes, créneau, durée d'arrêt,
 * réussites par heure, motifs d'échec, contacts déjà faits.
 *
 *  - NON BLOQUANT : la clôture est déjà enregistrée ; toute erreur (migration
 *    20261113000001 non appliquée, RLS…) est journalisée sans remonter.
 *  - IDEMPOTENT : delivery_stops.fiche_enregistree_le empêche de compter deux
 *    fois le même arrêt (double appui, rejeu de la file hors ligne).
 *  - MINIMISATION : seuls les établissements (nom d'entreprise connu, point
 *    relais) ou les adresses déjà dans l'annuaire sont retenus ; un particulier
 *    n'est jamais ajouté à l'annuaire.
 *  - Jamais d'écrasement par une valeur vide (voir fusionnerObservation).
 * Utilise le client de l'utilisateur : la RLS de delivery_address_hours limite
 * l'écriture aux chauffeurs et à l'encadrement de l'organisation.
 */
export async function enregistrerObservationArret(supabase: SupabaseClient, organizationId: string, userId: string, stopId: string): Promise<"enregistre" | "ignore"> {
  try {
    const { data: s, error } = await supabase
      .from("delivery_stops")
      .select("id, run_id, address, lat, lng, recipient, phone, notes, status, kind, done_at, window_start, window_end, failure_reason, business_name, contact_message, contact_phone, fiche_enregistree_le")
      .eq("id", stopId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) {
      if (!estSchemaManquant(error)) console.error("fiche client (non bloquant)", error.message);
      return "ignore";
    }
    const arret = s as {
      id: string; run_id: string; address: string; lat: number | string | null; lng: number | string | null; recipient: string | null; phone: string | null; notes: string | null;
      status: string; kind: string | null; done_at: string | null; window_start: string | null; window_end: string | null; failure_reason: string | null;
      business_name: string | null; contact_message: boolean | null; contact_phone: boolean | null; fiche_enregistree_le: string | null;
    } | null;
    if (!arret || arret.fiche_enregistree_le || (arret.status !== "delivered" && arret.status !== "failed") || !arret.done_at || !arret.address) return "ignore";

    const cle = cleAdresse(arret.address);
    if (!cle) return "ignore";
    const { data: existante, error: erreurFiche } = await supabase.from("delivery_address_hours").select(CHAMPS_FICHE).eq("organization_id", organizationId).eq("address_key", cle).maybeSingle();
    if (erreurFiche) {
      if (!estSchemaManquant(erreurFiche)) console.error("fiche client (non bloquant)", erreurFiche.message);
      return "ignore";
    }
    if (!retenirAdresse(arret, Boolean(existante))) return "ignore";

    // Clôture précédente de la même tournée : l'écart donne la durée d'arrêt.
    const { data: precedent } = await supabase
      .from("delivery_stops")
      .select("done_at, lat, lng")
      .eq("run_id", arret.run_id)
      .neq("status", "pending")
      .neq("id", arret.id)
      .lt("done_at", arret.done_at)
      .order("done_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const point = (lat: number | string | null | undefined, lng: number | string | null | undefined) => (lat === null || lat === undefined || lng === null || lng === undefined ? null : { lat: Number(lat), lng: Number(lng) });
    const prec = precedent as { done_at: string | null; lat: number | string | null; lng: number | string | null } | null;
    const dureeMin = prec?.done_at ? dureeObservee({ doneAt: prec.done_at, point: point(prec.lat, prec.lng) }, { doneAt: arret.done_at, point: point(arret.lat, arret.lng) }) : null;

    const livre = arret.status === "delivered";
    const obs: ObservationArret = {
      nom: arret.business_name,
      telephone: arret.phone,
      destinataire: arret.recipient,
      // Une note d'échec raconte un incident : seules les notes d'une livraison réussie fournissent des consignes.
      consignes: livre ? consignesDepuisNotes(arret.notes) : null,
      lat: arret.lat === null ? null : Number(arret.lat),
      lng: arret.lng === null ? null : Number(arret.lng),
      fenetre: { debut: arret.window_start, fin: arret.window_end },
      statut: livre ? "delivered" : "failed",
      motif: arret.failure_reason,
      heure: Math.floor(minutesParis(new Date(arret.done_at)) / 60),
      dureeMin,
      contactMessage: arret.contact_message === true,
      contactTelephone: arret.contact_phone === true,
      quand: arret.done_at,
    };
    const m = fusionnerObservation(existante as Record<string, unknown> | null, obs);
    const maintenant = new Date().toISOString();
    const { error: erreurEcriture } = await supabase.from("delivery_address_hours").upsert(
      {
        organization_id: organizationId,
        address_key: cle,
        address: (existante as { address?: string } | null)?.address ?? arret.address,
        ...m,
        updated_by: userId,
        updated_at: maintenant,
      },
      { onConflict: "organization_id,address_key" },
    );
    if (erreurEcriture) {
      if (!estSchemaManquant(erreurEcriture)) console.error("fiche client (non bloquant)", erreurEcriture.message);
      return "ignore";
    }
    await supabase.from("delivery_stops").update({ fiche_enregistree_le: maintenant }).eq("id", arret.id).is("fiche_enregistree_le", null);
    return "enregistre";
  } catch (e) {
    console.error("fiche client (non bloquant)", e instanceof Error ? e.message : e);
    return "ignore";
  }
}
