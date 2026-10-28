import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { cleAdresse, horairesDesAdresses, moduleActif, HOURS_FIELDS } from "@/lib/colis/serveur";
import { normaliserSemaine } from "@/lib/colis/horaires";
import { LONGUEURS } from "@/lib/colis/fiche-client";
import { normaliserTelephone } from "@/lib/colis/telephone";
import { codePays } from "@/lib/pays/serveur";

/** Saisie des horaires : chauffeurs et encadrement (pas la comptabilité). RLS identique. */
const PEUVENT_ECRIRE = ["chauffeur", "manager", "exploitation", "direction"] as const;

async function contexte(ecriture: boolean) {
  const g = await garderApi({ modules: ["route_optimizer"] });
  if (!g.ok) return { erreur: g.reponse };
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return { erreur: NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 }) };
  if (ecriture && !hasRole(appUser.role, [...PEUVENT_ECRIRE])) return { erreur: NextResponse.json({ error: "Réservé aux chauffeurs et à l'encadrement." }, { status: 403 }) };
  return { appUser, supabase };
}

/** Fiche horaires d'une adresse (?adresse=…), null si elle n'est pas dans l'annuaire. */
export async function GET(req: Request) {
  const ctx = await contexte(false);
  if ("erreur" in ctx) return ctx.erreur;
  const adresse = new URL(req.url).searchParams.get("adresse")?.trim();
  if (!adresse) return NextResponse.json({ error: "Adresse manquante." }, { status: 400 });
  const fiches = await horairesDesAdresses(ctx.supabase, ctx.appUser.organization_id, [adresse]);
  return NextResponse.json({ fiche: fiches.get(cleAdresse(adresse)) ?? null });
}

const putSchema = z.object({
  adresse: z.string().trim().min(5).max(300),
  /** Nom de l'entreprise ou du commerce. */
  nom: z.string().trim().max(120).nullable().optional(),
  /** Horaires d'ouverture ; absents : la fiche client est mise à jour sans toucher aux horaires. */
  semaine: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  /** Fiche client (RGPD : coordonnées de l'établissement, saisies par l'équipe) ; null : effacer la valeur. */
  telephone: z.string().trim().max(LONGUEURS.telephone).nullable().optional(),
  contact: z.string().trim().max(LONGUEURS.destinataire).nullable().optional(),
  consignes: z.string().trim().max(LONGUEURS.consignes).nullable().optional(),
});

/**
 * Enregistre les horaires d'une adresse pro dans l'annuaire de
 * l'entreprise : ils s'appliquent ensuite automatiquement à chaque arrêt
 * de même adresse (normalisée), quel que soit le chauffeur.
 */
export async function PUT(req: Request) {
  const ctx = await contexte(true);
  if ("erreur" in ctx) return ctx.erreur;
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const { adresse, nom, notes, telephone, contact, consignes } = parsed.data;
  const semaine = parsed.data.semaine ? normaliserSemaine(parsed.data.semaine) : null;
  const clientSaisi = telephone !== undefined || contact !== undefined || consignes !== undefined;
  const aHoraires = Boolean(semaine && Object.keys(semaine).length);
  if (!aHoraires && !clientSaisi) return NextResponse.json({ error: "Indiquez les horaires d'au moins un jour." }, { status: 400 });
  const cle = cleAdresse(adresse);
  if (!cle) return NextResponse.json({ error: "Adresse invalide." }, { status: 400 });
  let tel: string | null | undefined = undefined;
  if (telephone !== undefined) {
    tel = telephone ? normaliserTelephone(telephone, await codePays(ctx.appUser.organization_id)) : null;
    if (telephone && !tel) return NextResponse.json({ error: "Numéro de téléphone non reconnu." }, { status: 400 });
  }
  const fiche = {
    organization_id: ctx.appUser.organization_id,
    address_key: cle,
    address: adresse,
    ...(nom !== undefined ? { label: nom || null } : {}),
    ...(aHoraires ? { weekly_schedule: semaine } : {}),
    ...(notes !== undefined ? { notes: notes || null } : {}),
    updated_by: ctx.appUser.id,
    updated_at: new Date().toISOString(),
  };
  const client = {
    ...(tel !== undefined ? { phone: tel } : {}),
    ...(contact !== undefined ? { recipient: contact || null } : {}),
    ...(consignes !== undefined ? { access_notes: consignes || null } : {}),
  };
  // Saisie ou correction d'horaires par une personne : la fiche devient « manuelle » (jamais
  // écrasée par une recherche automatique). Colonnes récentes absentes (migrations non appliquées) : repli sans elles.
  const ecrire = (colonnes: Record<string, unknown>) => ctx.supabase.from("delivery_address_hours").upsert(colonnes, { onConflict: "organization_id,address_key" }).select(HOURS_FIELDS).single();
  const manuel = aHoraires ? { source: "manuel" } : {};
  let { data, error } = await ecrire({ ...fiche, ...manuel, ...client });
  if (error && /source/.test(error.message)) ({ data, error } = await ecrire({ ...fiche, ...client }));
  if (error && Object.keys(client).length && /phone|recipient|access_notes/.test(error.message)) {
    if (!aHoraires) return NextResponse.json({ error: "La fiche client sera disponible après la mise à jour de la base." }, { status: 503 });
    ({ data, error } = await ecrire({ ...fiche, ...manuel }));
  }
  if (!data) return NextResponse.json({ error: error?.message ?? "Enregistrement impossible." }, { status: 500 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const complete = (await horairesDesAdresses(ctx.supabase, ctx.appUser.organization_id, [adresse]).catch(() => new Map())).get(cle);
  return NextResponse.json({ fiche: complete ?? { ...data, weekly_schedule: normaliserSemaine(data.weekly_schedule) } });
}

/** Retire une adresse de l'annuaire (?adresse=…) : elle n'a plus d'horaires. */
export async function DELETE(req: Request) {
  const ctx = await contexte(true);
  if ("erreur" in ctx) return ctx.erreur;
  const adresse = new URL(req.url).searchParams.get("adresse")?.trim();
  if (!adresse) return NextResponse.json({ error: "Adresse manquante." }, { status: 400 });
  const { error } = await ctx.supabase.from("delivery_address_hours").delete().eq("organization_id", ctx.appUser.organization_id).eq("address_key", cleAdresse(adresse));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
