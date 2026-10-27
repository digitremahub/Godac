import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { journaliser } from "@/lib/audit/journal";
import { avantApres, aucunChangement } from "@/lib/audit/avant-apres";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { declarationCouvrant } from "@/lib/ticpe/declarations-serveur";
import { messagePeriodeDeclaree } from "@/lib/ticpe/regularisation";
import { jourParis } from "@/lib/ticpe/montant";
import { ROLES_SANS_ECRITURE_RLS } from "@/lib/ticpe/corrections";

/**
 * Corrections d'un plein pour la TICPE (justificatif, zone et pays, doublon),
 * partagées par les routes d'un plein (app/api/fuel-entries/[id]/justificatif,
 * zone, doublon) et par la correction en lot (app/api/ticpe/bloquants/lot).
 * Une seule écriture de chaque règle, une seule trace d'audit par plein.
 *
 * Droits : encadrement sous la RLS de fuel_entries (le manager ne touche que
 * son service) ; comptable via le client service, borné à son organisation
 * (la RLS de fuel_entries ne lui donne pas l'écriture). Seules des colonnes
 * TICPE sont écrites : jamais les litres, les prix ni les montants.
 */

export interface ContexteCorrection {
  appUser: { id: string; role: string; organization_id: string };
  supabase: SupabaseClient;
}

export type ResultatCorrection =
  | { ok: true }
  | { ok: false; statut: number; error: string; code?: string; periodeDeclaree?: string };

/** Client d'écriture : RLS pour l'encadrement, service (organisation vérifiée) pour le comptable. */
function clientEcriture(ctx: ContexteCorrection): SupabaseClient {
  return (ROLES_SANS_ECRITURE_RLS as readonly string[]).includes(ctx.appUser.role) ? createAdminSupabaseClient() : ctx.supabase;
}

const introuvable: ResultatCorrection = { ok: false, statut: 404, error: "Plein introuvable ou hors de votre périmètre." };
const migration = (n: string): ResultatCorrection => ({ ok: false, statut: 503, error: `Indisponible : la migration ${n} n'est pas encore appliquée.` });

/** Le plein appartient-il à une période déjà déclarée ? Sans confirmation : refus 409 (même contrat que verifierPeriodeDeclaree). */
async function gardePeriode(ctx: ContexteCorrection, occurredAt: string, confirme: boolean | undefined): Promise<{ refus: ResultatCorrection } | { periodeDeclaree: string | null }> {
  const decl = await declarationCouvrant(ctx.supabase, ctx.appUser.organization_id, [jourParis(occurredAt)]);
  if (!decl) return { periodeDeclaree: null };
  const nom = decl.periode_libelle ?? decl.periode_cle;
  if (!confirme) return { refus: { ok: false, statut: 409, error: messagePeriodeDeclaree(decl), code: "PERIODE_DECLAREE", periodeDeclaree: nom } };
  return { periodeDeclaree: nom };
}

/** Plein lu sous la RLS de la personne (périmètre) : le comptable lit toute l'organisation. */
async function lirePlein(ctx: ContexteCorrection, id: string, colonnes: string) {
  const db = clientEcriture(ctx);
  const { data, error } = await db.from("fuel_entries").select(colonnes).eq("id", id).eq("organization_id", ctx.appUser.organization_id).maybeSingle();
  return { plein: data as unknown as Record<string, unknown> | null, error };
}

export async function corrigerJustificatif(ctx: ContexteCorrection, id: string, entree: { type: "releve_carte" | "facture" | null; ref: string | null }): Promise<ResultatCorrection> {
  const { appUser } = ctx;
  const { data, error } = await clientEcriture(ctx)
    .from("fuel_entries")
    .update({ ticpe_justificatif: entree.type, ticpe_justificatif_ref: entree.type ? entree.ref || null : null })
    .eq("id", id)
    .eq("organization_id", appUser.organization_id)
    .select("id")
    .maybeSingle();
  if (error) return estSchemaManquant(error) ? migration("20261031000002") : { ok: false, statut: 500, error: error.message };
  if (!data) return introuvable;
  await journaliser({ organizationId: appUser.organization_id, userId: appUser.id, action: "plein_modification", targetTable: "fuel_entries", targetId: id, details: { ticpe_justificatif: entree.type, ticpe_justificatif_ref: entree.ref } });
  return { ok: true };
}

export async function corrigerZone(
  ctx: ContexteCorrection,
  id: string,
  entree: { ticpe_zone: "metropole" | "corse" | null; pays_achat: string | null; confirmer_periode_declaree?: boolean },
): Promise<ResultatCorrection> {
  const { appUser } = ctx;
  const { plein: avant, error: errLecture } = await lirePlein(ctx, id, "id, occurred_at, ticpe_zone, pays_achat");
  if (errLecture) return estSchemaManquant(errLecture) ? migration("20261101000004") : { ok: false, statut: 500, error: errLecture.message };
  if (!avant) return introuvable;
  const garde = await gardePeriode(ctx, avant.occurred_at as string, entree.confirmer_periode_declaree);
  if ("refus" in garde) return garde.refus;
  const champs = { ticpe_zone: entree.ticpe_zone, pays_achat: entree.pays_achat };
  const { error } = await clientEcriture(ctx).from("fuel_entries").update(champs).eq("id", id).eq("organization_id", appUser.organization_id);
  if (error) return estSchemaManquant(error) ? migration("20261101000004") : { ok: false, statut: 500, error: error.message };
  const diff = avantApres(avant, champs);
  if (!aucunChangement(diff)) {
    await journaliser({ organizationId: appUser.organization_id, userId: appUser.id, action: "plein_modification", targetTable: "fuel_entries", targetId: id, details: { ...diff, ...(garde.periodeDeclaree ? { periode_declaree: garde.periodeDeclaree } : {}) } });
  }
  return { ok: true };
}

export async function corrigerDoublon(ctx: ContexteCorrection, id: string, entree: { lever: boolean; confirmer_periode_declaree?: boolean }): Promise<ResultatCorrection> {
  const { appUser } = ctx;
  const { plein, error: errLecture } = await lirePlein(ctx, id, "id, occurred_at");
  if (errLecture) return { ok: false, statut: 500, error: errLecture.message };
  if (!plein) return introuvable;
  const garde = await gardePeriode(ctx, plein.occurred_at as string, entree.confirmer_periode_declaree);
  if ("refus" in garde) return garde.refus;
  const maintenant = new Date().toISOString();
  const { data, error } = await clientEcriture(ctx)
    .from("fuel_entries")
    .update(entree.lever ? { ticpe_doublon_leve_le: maintenant, ticpe_doublon_leve_par: appUser.id } : { ticpe_doublon_leve_le: null, ticpe_doublon_leve_par: null })
    .eq("id", id)
    .eq("organization_id", appUser.organization_id)
    .select("id")
    .maybeSingle();
  if (error) return estSchemaManquant(error) ? migration("20261101000003") : { ok: false, statut: 500, error: error.message };
  if (!data) return introuvable;
  await journaliser({
    organizationId: appUser.organization_id,
    userId: appUser.id,
    action: "plein_doublon_leve",
    targetTable: "fuel_entries",
    targetId: id,
    details: { avant: { doublon_leve: !entree.lever }, apres: { doublon_leve: entree.lever }, ...(garde.periodeDeclaree ? { periode_declaree: garde.periodeDeclaree } : {}) },
  });
  return { ok: true };
}

/** Réponse HTTP d'une correction (même corps d'erreur que verifierPeriodeDeclaree). */
export function reponseCorrection(r: ResultatCorrection) {
  if (r.ok) return NextResponse.json({ ok: true });
  return NextResponse.json({ error: r.error, ...(r.code ? { code: r.code } : {}), ...(r.periodeDeclaree ? { periodeDeclaree: r.periodeDeclaree } : {}) }, { status: r.statut });
}
