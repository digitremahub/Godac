import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { journaliser } from "@/lib/audit/journal";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { avantApres, aucunChangement } from "@/lib/audit/avant-apres";
import { declarationCouvrant } from "@/lib/ticpe/declarations-serveur";
import { jourParis } from "@/lib/ticpe/montant";
import { messagePeriodeDeclaree, modifieLeMontantTicpe } from "@/lib/ticpe/regularisation";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { MOTIF_MAX } from "@/lib/fuel/controles-saisie";
import { evaluerControlesSaisie, suiteControles } from "@/lib/fuel/controles-saisie-serveur";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";

const patchSchema = z.object({
  totalizer_before: z.coerce.number().nonnegative().nullable().optional(),
  totalizer_after: z.coerce.number().positive().nullable().optional(),
  totalizer_before_photo_path: z.string().optional(),
  totalizer_after_photo_path: z.string().optional(),
  vehicle_km: z.coerce.number().nonnegative().optional(),
  vehicle_km_photo_path: z.string().optional(),
  liters: z.coerce.number().positive().max(5000).optional(),
  unit_price: z.coerce.number().positive().max(10).optional(),
  product: z.enum(["gazole", "adblue"]).optional(),
  occurred_at: z.string().datetime().optional(),
  station_name: z.string().nullable().optional(),
  vehicle_id: z.string().uuid().optional(),
  // null : achat en station (aucune cuve).
  tank_id: z.string().uuid().nullable().optional(),
  /** Set by the OCR review UI (Module 3) once a manager confirms the extracted/corrected fields. */
  validate: z.boolean().optional(),
  /** Set when an ocr_failed row is completed by hand — the degraded-mode fallback never silently drops the ticket photo already attached. */
  markManual: z.boolean().optional(),
  /** Confirmation explicite : le plein appartient à une période TICPE déjà déclarée. */
  confirmer_periode_declaree: z.boolean().optional(),
  /** Confirmation des contrôles km / capacité (réponse 409 CONTROLE_A_CONFIRMER) : le plein est enregistré et l'écart signalé à l'encadrement. */
  confirmer_controles: z.object({ motif: z.string().trim().max(MOTIF_MAX) }).optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ roles: "tous" });
  if (!g.ok) return g.reponse;
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("fuel_entries")
    .select(
      "id, status, occurred_at, liters, unit_price, station_name, totalizer_before, totalizer_after, ocr_error, ocr_confidence, gap_flagged, totalizer_gap, pmp_at_entry, ticket_photo_path, vehicle_id, tank_id",
    )
    .eq("id", id)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }

  return NextResponse.json({ fuelEntry: data });
}

/**
 * Edits a fuel entry, and/or promotes it to `validated`. RLS is the
 * real gate on who can touch which row (migration 122 : le chauffeur
 * complète et valide son ticket en attente, la modification d'un plein
 * enregistré revient au manager / à la direction) ; the triggers of
 * migration 121 report any change of litres or tank onto the tank stock.
 * Mêmes contrôles de kilométrage et de capacité du réservoir qu'à la création
 * (POST), avec la même issue : « à confirmer » (409) puis confirmation motivée,
 * jamais une saisie perdue à la fin du parcours.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g2 = await garderApi({ roles: "tous" });
  if (!g2.ok) return g2.reponse;
  const appUser = g2.appUser;
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { validate, markManual, confirmer_periode_declaree, confirmer_controles, ...fields } = parsed.data;
  const supabase = await createServerSupabaseClient();

  // État d'avant : statut, cuve, date et les colonnes que cette demande va modifier (pour le journal avant / après).
  const colonnesAvant = [...new Set(["status", "tank_id", "occurred_at", "vehicle_id", "liters", "vehicle_km", "product", ...Object.keys(fields)])];
  const { data: currentBrut } = await supabase.from("fuel_entries").select(colonnesAvant.join(", ")).eq("id", id).maybeSingle();
  const current = currentBrut as unknown as
    | (Record<string, unknown> & { status: string; tank_id: string | null; occurred_at: string; vehicle_id: string; liters: number | string | null; vehicle_km: number | string | null; product: string | null })
    | null;
  if (!current) return NextResponse.json({ error: "Plein introuvable." }, { status: 404 });
  const dejaEnregistre = current.status === "manual" || current.status === "validated";
  // Revalider un plein déjà enregistré ne doit rien rejouer (stock, alertes).
  if (dejaEnregistre && (validate || markManual)) {
    return NextResponse.json({ error: "Ce plein est déjà enregistré." }, { status: 409 });
  }
  if (fields.occurred_at && new Date(fields.occurred_at).getTime() > Date.now() + 10 * 60_000) {
    return NextResponse.json({ error: "La date du plein est dans le futur." }, { status: 422 });
  }
  // Plein d'une période TICPE déjà déclarée : la modification change le montant calculé, donc demande une confirmation.
  let periodeDeclaree: string | null = null;
  if (dejaEnregistre && modifieLeMontantTicpe(fields)) {
    const jours = [jourParis(current.occurred_at), ...(fields.occurred_at ? [jourParis(fields.occurred_at)] : [])];
    const decl = await declarationCouvrant(supabase, appUser.organization_id, jours);
    if (decl) {
      if (!confirmer_periode_declaree) {
        return NextResponse.json({ error: messagePeriodeDeclaree(decl), code: "PERIODE_DECLAREE", periodeDeclaree: decl.periode_libelle ?? decl.periode_cle }, { status: 409 });
      }
      periodeDeclaree = decl.periode_libelle ?? decl.periode_cle;
    }
  }
  const tankFinal = fields.tank_id !== undefined ? fields.tank_id : current.tank_id;
  if (tankFinal === null) {
    // Achat en station : ni totaliseur, ni produit déduit d'une cuve.
    fields.totalizer_before = null;
    fields.totalizer_after = null;
  } else if (fields.product !== undefined) {
    // Plein cuve : le produit est celui de la cuve (fixé par la base).
    delete fields.product;
  }

  // Contrôles de saisie (capacité du réservoir, kilométrage), comme à la création. Évalués à la validation
  // ou à la finition manuelle d'un ticket, et quand une valeur qu'ils lisent est modifiée.
  const finalise = Boolean(validate || markManual);
  const touchePlein = fields.liters !== undefined || fields.product !== undefined || fields.vehicle_id !== undefined;
  const toucheKm = fields.vehicle_km !== undefined || fields.occurred_at !== undefined || fields.vehicle_id !== undefined;
  let confirme = null as import("@/lib/fuel/controles-saisie").ControleConfirme | null;
  if (finalise || touchePlein || toucheKm) {
    const vehicleId = fields.vehicle_id ?? current.vehicle_id;
    const { data: vehicle } = await createAdminSupabaseClient()
      .from("vehicles")
      .select("id, tank_capacity_liters, adblue_capacity_liters")
      .eq("id", vehicleId)
      .eq("organization_id", appUser.organization_id)
      .maybeSingle();
    if (!vehicle) return NextResponse.json({ error: "Véhicule introuvable." }, { status: 404 });
    const litres = fields.liters ?? (current.liters === null ? null : Number(current.liters));
    const km = fields.vehicle_km ?? (current.vehicle_km === null ? null : Number(current.vehicle_km));
    const produit = (fields.product ?? current.product) === "adblue" ? "adblue" : "gazole";
    const controles = await evaluerControlesSaisie(createAdminSupabaseClient(), {
      vehicle,
      liters: finalise || touchePlein ? litres : null,
      product: produit,
      km: finalise || toucheKm ? km : null,
      occurredAt: fields.occurred_at ?? current.occurred_at,
      excludeFuelEntryId: id,
    });
    const suite = suiteControles(controles, confirmer_controles, appUser.id);
    if ("reponse" in suite) return suite.reponse;
    confirme = suite.confirme;
  }

  const update: Record<string, unknown> = { ...fields };
  if (validate) {
    update.status = "validated";
    update.validated_by = appUser.id;
    update.validated_at = new Date().toISOString();
  } else if (markManual) {
    update.status = "manual";
  }

  const ecrire = (champs: Record<string, unknown>) =>
    supabase.from("fuel_entries").update(champs).eq("id", id).select("id, status, gap_flagged, totalizer_gap, pmp_at_entry").single();
  let { data, error } = await ecrire(confirme ? { ...update, controle_confirme: confirme } : update);
  let confirmationPerdue = false;
  if (error && confirme && estSchemaManquant(error)) {
    // Migration 20261108000003 pas appliquée : la saisie n'est jamais perdue, la confirmation est tracée au journal.
    confirmationPerdue = true;
    ({ data, error } = await ecrire(update));
  }

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Plein non enregistré." }, { status: 500 });
  }
  if (confirme) {
    await journaliser({
      organizationId: appUser.organization_id,
      userId: appUser.id,
      action: "plein_controle_confirme",
      targetTable: "fuel_entries",
      targetId: id,
      details: { controles: confirme.controles.map((c) => c.code), motif: confirme.motif, ...(confirmationPerdue ? { colonne_absente: true } : {}) },
    });
  }

  if (dejaEnregistre) {
    // Journal : ancienne et nouvelle valeur de chaque champ réellement changé.
    const diff = avantApres(current, fields);
    if (!aucunChangement(diff)) {
      await journaliser({
        organizationId: appUser.organization_id,
        userId: appUser.id,
        action: "plein_modification",
        targetTable: "fuel_entries",
        targetId: id,
        details: { ...diff, ...(periodeDeclaree ? { periode_declaree: periodeDeclaree } : {}) },
      });
    }
  }
  return NextResponse.json({ fuelEntry: data });
}
