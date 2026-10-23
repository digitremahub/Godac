import { NextResponse } from "next/server";
import { garderApi } from "@/lib/acces/garde-api";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { chargerSuiviEcarts } from "@/lib/fuel/ecarts-serveur";
import { droitsEcart, ecartsDuPlein, statutEcart } from "@/lib/fuel/ecarts";
import { compterDirection, lirePersonne } from "@/lib/hierarchie/serveur";
import { libelleADecider } from "@/lib/hierarchie/demandes";
import { ticketExtrasFromOcrRaw } from "@/lib/ocr/ticket-check";
import type { DetailPlein, PhotoPlein, TicpeDuPlein } from "@/lib/fuel/detail-plein";
import { calculerTicpe } from "@/lib/ticpe/calcul-serveur";
import { declarationCouvrant } from "@/lib/ticpe/declarations-serveur";
import { jourParis } from "@/lib/ticpe/montant";
import { LIBELLES_CATEGORIE_COURTS, LIBELLES_ZONE } from "@/lib/ticpe/bareme";

const BUCKET_TICKETS = process.env.SUPABASE_STORAGE_BUCKET ?? "fuel-tickets";
const DUREE_URL_SECONDES = 600;

function nombre(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fiche complète d'un plein pour l'historique carburant : tout ce qui a
 * été saisi (date, chauffeur, véhicule, kilométrage, totaliseur, litres,
 * prix, produit, cuve / station), les photos (ticket, totaliseur avant /
 * après, compteur), l'OCR, la validation, les écarts détectés et leur
 * traitement, les alertes liées et les corrections (journal d'audit).
 *
 * La RLS de fuel_entries décide de la visibilité : un chauffeur n'ouvre
 * que ses pleins, un manager ceux de son service.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ ecran: "carburant.pleins" });
  if (!g.ok) return g.reponse;
  const { appUser, supabase, modules } = g;

  const { data: e, error } = await supabase
    .from("fuel_entries")
    .select(
      "id, organization_id, occurred_at, created_at, updated_at, status, product, liters, unit_price, total_amount, station_name, tank_id, vehicle_id, driver_id, vehicle_km, vehicle_km_photo_path, totalizer_before, totalizer_after, totalizer_before_photo_path, totalizer_after_photo_path, totalizer_gap, gap_flagged, pmp_at_entry, ticket_photo_path, ocr_raw, ocr_confidence, ocr_error, created_by, validated_by, validated_at, vehicles(registration), tanks(name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!e) return NextResponse.json({ error: "Plein introuvable." }, { status: 404 });

  const suivi = await chargerSuiviEcarts(supabase, [id]);
  const traitements = suivi.traitements.get(id) ?? [];
  // Hiérarchie des demandes : le conducteur du plein décide du rang requis pour traiter l'écart.
  const conducteur = e.driver_id && appUser.role !== "chauffeur" ? await lirePersonne(supabase, appUser.organization_id, e.driver_id) : null;
  const directionCount = appUser.role === "chauffeur" ? 2 : await compterDirection(supabase, appUser.organization_id);
  const alertes = suivi.alertes.get(id) ?? [];
  const ecarts = ecartsDuPlein(e, alertes);
  const statut = statutEcart(ecarts.length, traitements);

  const droits = droitsEcart({ role: appUser.role, userId: appUser.id, driverId: e.driver_id, statut, roleChauffeur: conducteur?.role, directionCount });
  // Lecture seule : écart à traiter, mais pas par cette personne (son plein, ou rang insuffisant).
  const mention = !droits.traiter && ["manager", "exploitation", "direction"].includes(appUser.role) && (statut === "ouvert" || statut === "reponse_recue" || statut === "explication_demandee") ? libelleADecider(conducteur?.role ?? "chauffeur") : null;

  // Journal d'audit (corrections d'un plein enregistré) : lu en service
  // (RLS direction seule), montré à l'encadrement et au comptable — le
  // plein lui-même vient d'être lu sous la RLS de la personne connectée.
  const admin = createAdminSupabaseClient();
  const voitCorrections = appUser.role !== "chauffeur";
  const { data: audit } = voitCorrections
    ? await admin
        .from("audit_log")
        .select("id, user_id, created_at, details")
        .eq("organization_id", appUser.organization_id)
        .eq("target_table", "fuel_entries")
        .eq("target_id", id)
        .eq("action", "plein_modification")
        .order("created_at", { ascending: true })
    : { data: null };

  // Noms (chauffeur, saisie, validation, traitements, corrections) : la RLS
  // de users ne laisse pas toujours un chauffeur lire les autres comptes ;
  // seuls les noms de la même organisation sont renvoyés.
  const idsNoms = new Set<string>(
    [e.driver_id, e.created_by, e.validated_by, ...traitements.map((t) => t.created_by), ...(audit ?? []).map((a) => a.user_id)].filter(
      (x): x is string => typeof x === "string",
    ),
  );
  const { data: personnes } = idsNoms.size
    ? await admin.from("users").select("id, full_name").eq("organization_id", appUser.organization_id).in("id", [...idsNoms])
    : { data: [] as { id: string; full_name: string }[] };
  const nom = (uid: string | null | undefined) => (uid ? (personnes ?? []).find((p) => p.id === uid)?.full_name ?? null : null);

  // Photos : ticket et totaliseurs dans le bucket des tickets, compteur
  // kilométrique dans tour-photos (app/api/ocr/odometer/init).
  const aSigner: { libelle: string; bucket: string; chemin: string | null }[] = [
    { libelle: "Ticket", bucket: BUCKET_TICKETS, chemin: e.ticket_photo_path },
    { libelle: "Totaliseur avant", bucket: BUCKET_TICKETS, chemin: e.totalizer_before_photo_path },
    { libelle: "Totaliseur après", bucket: BUCKET_TICKETS, chemin: e.totalizer_after_photo_path },
    { libelle: "Compteur kilométrique", bucket: "tour-photos", chemin: e.vehicle_km_photo_path },
  ];
  const photos: PhotoPlein[] = (
    await Promise.all(
      aSigner
        .filter((p) => p.chemin)
        .map(async (p) => {
          const { data } = await supabase.storage.from(p.bucket).createSignedUrl(p.chemin!, DUREE_URL_SECONDES);
          return data?.signedUrl ? { libelle: p.libelle, url: data.signedUrl } : null;
        }),
    )
  ).filter((p): p is PhotoPlein => p !== null);

  const ticket = ticketExtrasFromOcrRaw(e.ocr_raw);
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

  // TICPE : montant du plein (plafond compté sur l'année du véhicule).
  let ticpe: TicpeDuPlein | null = null;
  if (modules.has("ticpe_export") && appUser.role !== "chauffeur" && e.product === "gazole") {
    try {
      const annee = Number(jourParis(e.occurred_at).slice(0, 4));
      const calcul = await calculerTicpe(supabase, appUser.organization_id, { anneeDebut: annee, anneeFin: annee, vehicleIds: [e.vehicle_id] });
      const l = calcul.lignes.find((x) => x.id === id);
      const declaree = l ? await declarationCouvrant(supabase, appUser.organization_id, [jourParis(e.occurred_at)]) : null;
      if (l) {
        ticpe = {
          statut: l.statut,
          raison: l.raison,
          categorie: l.categorie ? LIBELLES_CATEGORIE_COURTS[l.categorie] : null,
          zone: l.zone ? LIBELLES_ZONE[l.zone] : null,
          origineZone: l.origineZone,
          taux: l.taux,
          tauxAConfirmer: l.tauxAConfirmer,
          origineTaux: l.origineTaux,
          litres: l.litres,
          litresRetenus: l.litresRetenus,
          litresHorsPlafond: l.litresHorsPlafond,
          montant: l.montant,
          justificatif: l.justificatif,
          justificatifModifiable: ["manager", "exploitation", "direction"].includes(appUser.role) && !e.ticket_photo_path,
          zoneSaisie: calcul.pleins.get(id)?.ticpe_zone === "corse" || calcul.pleins.get(id)?.ticpe_zone === "metropole" ? (calcul.pleins.get(id)!.ticpe_zone as "corse" | "metropole") : null,
          zonePropose: l.zonePropose ? LIBELLES_ZONE[l.zonePropose] : null,
          zoneIncertaine: l.zoneIncertaine === true,
          paysAchat: calcul.pleins.get(id)?.pays_achat ?? null,
          zoneModifiable: ["manager", "exploitation", "direction"].includes(appUser.role),
          periodeDeclaree: declaree ? (declaree.periode_libelle ?? declaree.periode_cle) : null,
          doublon: l.doublon === true,
          doublonLeveLe: calcul.pleins.get(id)?.ticpe_doublon_leve_le ?? null,
          doublonLevable: ["manager", "exploitation", "direction"].includes(appUser.role) && (l.doublon === true || Boolean(calcul.pleins.get(id)?.ticpe_doublon_leve_le)),
        };
      }
    } catch (err) {
      console.error("TICPE du plein", err);
    }
  }

  const detail: DetailPlein = {
    id: e.id,
    occurred_at: e.occurred_at,
    created_at: e.created_at,
    updated_at: e.updated_at,
    status: e.status,
    product: e.product,
    liters: nombre(e.liters),
    unit_price: nombre(e.unit_price),
    total_amount: nombre(e.total_amount),
    station_name: e.station_name,
    tank_id: e.tank_id,
    cuve: one(e.tanks as { name: string } | { name: string }[] | null)?.name ?? null,
    vehicule: one(e.vehicles as { registration: string } | { registration: string }[] | null)?.registration ?? null,
    chauffeur: nom(e.driver_id),
    vehicle_km: nombre(e.vehicle_km),
    totalizer_before: nombre(e.totalizer_before),
    totalizer_after: nombre(e.totalizer_after),
    totalizer_gap: nombre(e.totalizer_gap),
    gap_flagged: Boolean(e.gap_flagged),
    pmp_at_entry: nombre(e.pmp_at_entry),
    saisi_par: nom(e.created_by),
    valide_par: nom(e.validated_by),
    validated_at: e.validated_at,
    ocr_error: e.ocr_error,
    ocr_confidence: e.ocr_confidence && typeof e.ocr_confidence === "object" ? (e.ocr_confidence as Record<string, number | null>) : null,
    ticket_total: ticket.total_amount,
    ticket_carburant: ticket.fuel_type,
    photos,
    ecarts,
    statutEcart: statut,
    traitements: traitements.map((t) => ({ id: t.id, action: t.action, commentaire: t.commentaire, auteur: nom(t.created_by), created_at: t.created_at })),
    traitementDisponible: suivi.traitementDisponible,
    alertes: alertes.map((a) => ({ id: a.id, type: a.type, severity: a.severity, message: a.message ?? null, status: a.status, created_at: a.created_at })),
    corrections: voitCorrections
      ? (audit ?? []).map((a) => ({
          id: a.id,
          auteur: nom(a.user_id),
          created_at: a.created_at,
          details: a.details && typeof a.details === "object" ? (a.details as Record<string, unknown>) : null,
        }))
      : null,
    droits: suivi.traitementDisponible ? { ...droits, mention } : { traiter: false, repondre: false, mention: null },
    ticpe,
  };

  return NextResponse.json({ plein: detail });
}
