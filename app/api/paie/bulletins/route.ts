import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { journaliser } from "@/lib/audit/journal";
import { ROLES_GENERATION } from "@/lib/paie/validation";
import { paieIndisponible, paysOrganisation } from "@/lib/pays/serveur";
import { calculerBulletin } from "@/lib/paie/calcul";
import { contextePaie, moisValide } from "@/lib/paie/donnees";
import { genererBulletinPdf } from "@/lib/paie/pdf";
import { donneesBulletinPdf } from "@/lib/paie/rendu-bulletin";
import { variablesSchema } from "@/lib/paie/schemas";
import { paiementDuBulletin } from "@/lib/paie/paiement";
import { fusionnerRetenues } from "@/lib/paie/acomptes";
import { rattacherAcomptes } from "@/lib/paie/acomptes-serveur";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ArretTravail } from "@/lib/paie/types";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";

export const maxDuration = 60;

async function synchroniserArrets(supabase: SupabaseClient, organizationId: string, auteur: string, userId: string, debut: string, fin: string, arrets: ArretTravail[]) {
  // Un arrêt déclaré par le salarié ou saisi par l'encadrement (declared_by),
  // ou refusé, n'est jamais supprimé depuis le bulletin : il se refuse dans
  // Équipe › Congés › Arrêts. Seuls les arrêts saisis par la paie le sont.
  // Colonnes absentes (migration 20261030000001) : comportement d'origine.
  const lire = (colonnes: string) => supabase.from("work_stoppages").select(colonnes).eq("user_id", userId).lte("start_date", fin).gte("end_date", debut);
  let { data: existants, error } = await lire("id, declared_by, status");
  if (error && estSchemaManquant(error)) ({ data: existants, error } = await lire("id"));
  if (error) return;
  const garder = new Set(arrets.map((a) => a.id).filter(Boolean));
  const retires = ((existants ?? []) as unknown as { id: string; declared_by?: string | null; status?: string | null }[])
    .filter((e) => !e.declared_by && e.status !== "refuse")
    .map((e) => String(e.id))
    .filter((id) => !garder.has(id));
  if (retires.length) await supabase.from("work_stoppages").delete().eq("user_id", userId).in("id", retires);
  if (!arrets.length) return;
  const lignes = arrets.map((a) => ({
    id: a.id ?? randomUUID(),
    organization_id: organizationId,
    user_id: userId,
    stoppage_type: a.type,
    start_date: a.du,
    end_date: a.au,
    extension_of: a.prolongationDu ?? null,
    daily_ijss_gross: a.ijssBrutesJour ?? null,
    daily_ijss_net: a.ijssNettesJour ?? null,
    ijss_days: a.joursIjss ?? null,
    manual_maintenance: a.maintienManuel ?? null,
    created_by: auteur,
    updated_at: new Date().toISOString(),
  }));
  const { error: e } = await supabase.from("work_stoppages").upsert(lignes);
  if (e) console.error("paie: enregistrement des arrêts impossible", e.message);
}

const bodySchema = z.object({ user_id: z.string().uuid(), mois: z.string(), variables: variablesSchema });

/**
 * Calcule le bulletin du mois avec le moteur (lib/paie/calcul.ts), en
 * relisant côté serveur profil, réglages et cumuls — les chiffres
 * affichés à l'écran ne sont jamais repris tels quels du navigateur —,
 * génère le PDF et l'enregistre. Un bulletin déjà généré pour ce mois
 * est remplacé (correction) et repasse « en attente de validation ».
 */
export async function POST(req: Request) {
  // Décision client Q1 : direction ET comptable génèrent ; le bulletin naît
  // « en attente de validation direction » (trigger payslips_guard_validation).
  const g = await garderApi({ roles: ROLES_GENERATION, modules: ["payslips"] });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const pays = await paysOrganisation(supabase, appUser.organization_id);
  if (!pays.paie.moteur) return NextResponse.json({ error: paieIndisponible(pays) }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success || !moisValide(parsed.data.mois)) return NextResponse.json({ error: "Variables du mois invalides." }, { status: 400 });
  const { user_id: userId, mois } = parsed.data;

  const [{ data: employe }, { data: organisation }, { data: dossier }] = await Promise.all([
    supabase.from("users").select("id, full_name, role_title, address").eq("id", userId).eq("organization_id", appUser.organization_id).maybeSingle(),
    supabase.from("organizations").select("name, siret, legal_address, ape_code, convention_collective, urssaf_number, logo_url, accent_color").eq("id", appUser.organization_id).single(),
    supabase.from("employee_files").select("matricule, social_security_number, hire_date, contract_type").eq("user_id", userId).maybeSingle(),
  ]);
  if (!employe) return NextResponse.json({ error: "Salarié introuvable." }, { status: 404 });

  const ctx = await contextePaie(supabase, appUser.organization_id, userId, mois);
  if (!ctx.profilComplet) return NextResponse.json({ error: "Renseignez d'abord le profil de paie (taux horaire, heures) de ce salarié." }, { status: 422 });

  // Acomptes des demandes acceptées : relus en base, jamais repris du navigateur.
  const variables = {
    ...parsed.data.variables,
    retenues: fusionnerRetenues(parsed.data.variables.retenues, ctx.acomptes.retenues),
    cumulHeuresSupExonereesAnnee: ctx.cumuls.heuresSupExonerees,
    // Cumuls de référence des congés et éléments de sortie : relus en base.
    cpReference: ctx.prefill.cpReference ?? null,
    sortie: ctx.prefill.sortie ?? null,
    // Date et mode de paiement toujours enregistrés (défaut : fin de mois, virement).
    ...paiementDuBulletin(mois, parsed.data.variables),
  };
  const bulletin = calculerBulletin({ legal: ctx.legal, entreprise: ctx.entreprise, salarie: ctx.salarie, variables, periode: { debut: ctx.debut, fin: ctx.fin } });

  let pdf: Buffer;
  try {
    pdf = await genererBulletinPdf(donneesBulletinPdf({ ctx, bulletin, variables, organisation, employe, dossier }));
  } catch (e) {
    console.error("paie: rendu PDF impossible", e);
    return NextResponse.json({ error: "Échec de la génération du PDF." }, { status: 500 });
  }

  const filePath = `${appUser.organization_id}/${userId}/${randomUUID()}.pdf`;
  const { error: uploadError } = await supabase.storage.from("payslips").upload(filePath, pdf, { contentType: "application/pdf" });
  if (uploadError) return NextResponse.json({ error: `Échec de l'envoi du PDF : ${uploadError.message}` }, { status: 500 });

  const row = {
    gross_amount: bulletin.brut,
    net_amount: bulletin.netAPayer,
    net_taxable: bulletin.netImposable,
    pas_amount: bulletin.montantPas,
    employer_cost: bulletin.coutEmployeur,
    overtime_exempt: bulletin.heuresSupExonerees,
    bonus_amount: variables.primes.reduce((t, p) => t + (p.soumise ? p.montant : 0), 0),
    meal_vouchers_amount: 0,
    details: bulletin,
    variables,
    file_path: filePath,
    status: "generated",
    generated_by: appUser.id,
    generated_at: new Date().toISOString(),
  };

  let payslipId: string;
  if (ctx.bulletinExistant) {
    const { data: ancien } = await supabase.from("payslips").select("file_path").eq("id", ctx.bulletinExistant.id).single();
    const { error } = await supabase.from("payslips").update(row).eq("id", ctx.bulletinExistant.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (ancien?.file_path) await supabase.storage.from("payslips").remove([ancien.file_path]);
    payslipId = ctx.bulletinExistant.id;
  } else {
    const { data, error } = await supabase
      .from("payslips")
      .insert({ ...row, organization_id: appUser.organization_id, user_id: userId, period_start: ctx.debut, period_end: ctx.fin })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    payslipId = data.id;
  }

  // Arrêts du mois enregistrés dans work_stoppages (compteurs de congés,
  // mois suivants) ; ceux retirés du bulletin sont supprimés. Table
  // absente (migration 20261026000002) : ignoré.
  await synchroniserArrets(supabase, appUser.organization_id, appUser.id, userId, ctx.debut, ctx.fin, variables.arrets ?? []);

  // Le bulletin référence les demandes d'acompte qu'il déduit.
  await rattacherAcomptes(supabase, payslipId, ctx.acomptes.ids);

  await journaliser({
    organizationId: appUser.organization_id,
    userId: appUser.id,
    action: "paie_bulletin_genere",
    targetTable: "payslips",
    targetId: payslipId,
    details: { salarie: userId, mois, regeneration: Boolean(ctx.bulletinExistant), par: appUser.role, acomptes: ctx.acomptes.ids.length },
  });

  // La direction qui génère elle-même valide dans la foulée (c'est elle qui
  // valide) ; un bulletin du comptable attend sa décision.
  let validation: "en_attente" | "valide" = "en_attente";
  if (appUser.role === "direction") {
    const { error: validationError } = await supabase.from("payslips").update({ validation_status: "valide" }).eq("id", payslipId);
    if (!validationError) {
      validation = "valide";
      await journaliser({
        organizationId: appUser.organization_id,
        userId: appUser.id,
        action: "paie_bulletin_valide",
        targetTable: "payslips",
        targetId: payslipId,
        details: { salarie: userId, mois, automatique: true },
      });
    }
  }

  return NextResponse.json({ id: payslipId, netAPayer: bulletin.netAPayer, validation });
}
