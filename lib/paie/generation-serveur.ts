import "server-only";
import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppUser } from "@/lib/auth/session";
import { journaliser } from "@/lib/audit/journal";
import { calculerBulletin } from "@/lib/paie/calcul";
import { contextePaie, type ContextePaie } from "@/lib/paie/donnees";
import { genererBulletinPdf } from "@/lib/paie/pdf";
import { donneesBulletinPdf } from "@/lib/paie/rendu-bulletin";
import { paiementDuBulletin } from "@/lib/paie/paiement";
import { fusionnerRetenues } from "@/lib/paie/acomptes";
import { rattacherAcomptes } from "@/lib/paie/acomptes-serveur";
import type { ArretTravail, VariablesMois } from "@/lib/paie/types";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";

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

export type ResultatGeneration = { ok: true; id: string; netAPayer: number; validation: "en_attente" | "valide" } | { ok: false; status: number; error: string };

/**
 * Calcule le bulletin du mois avec le moteur (lib/paie/calcul.ts), en
 * relisant côté serveur profil, réglages et cumuls — les chiffres
 * affichés à l'écran ne sont jamais repris tels quels du navigateur —,
 * génère le PDF et l'enregistre. Un bulletin déjà généré pour ce mois
 * est remplacé (correction) et repasse « en attente de validation ».
 * Partagé par la route unitaire (app/api/paie/bulletins) et la préparation
 * en lot (app/api/paie/lot) : mêmes calculs, aucune formule dupliquée.
 *
 * `validerSiDirection` : la direction qui génère elle-même un bulletin le
 * valide dans la foulée (route unitaire). La préparation en lot ne valide
 * jamais : la direction passe par l'écran d'anomalies puis valide.
 * `contexte` : contexte de paie déjà lu par l'appelant (évite une seconde lecture).
 */
export async function genererBulletinMois(p: {
  supabase: SupabaseClient;
  appUser: Pick<AppUser, "id" | "role" | "organization_id">;
  userId: string;
  mois: string;
  variables: Omit<VariablesMois, "cumulHeuresSupExonereesAnnee">;
  validerSiDirection: boolean;
  contexte?: ContextePaie;
  lot?: boolean;
}): Promise<ResultatGeneration> {
  const { supabase, appUser, userId, mois } = p;
  const [{ data: employe }, { data: organisation }, { data: dossier }] = await Promise.all([
    supabase.from("users").select("id, full_name, role_title, address").eq("id", userId).eq("organization_id", appUser.organization_id).maybeSingle(),
    supabase.from("organizations").select("name, siret, legal_address, ape_code, convention_collective, urssaf_number, logo_url, accent_color").eq("id", appUser.organization_id).single(),
    supabase.from("employee_files").select("matricule, social_security_number, hire_date, contract_type").eq("user_id", userId).maybeSingle(),
  ]);
  if (!employe) return { ok: false, status: 404, error: "Salarié introuvable." };

  const ctx = p.contexte ?? (await contextePaie(supabase, appUser.organization_id, userId, mois));
  if (!ctx.profilComplet) return { ok: false, status: 422, error: "Renseignez d'abord le profil de paie (taux horaire, heures) de ce salarié." };

  // Acomptes des demandes acceptées : relus en base, jamais repris du navigateur.
  const variables = {
    ...p.variables,
    retenues: fusionnerRetenues(p.variables.retenues, ctx.acomptes.retenues),
    cumulHeuresSupExonereesAnnee: ctx.cumuls.heuresSupExonerees,
    // Cumuls de référence des congés et éléments de sortie : relus en base.
    cpReference: ctx.prefill.cpReference ?? null,
    sortie: ctx.prefill.sortie ?? null,
    // Date et mode de paiement toujours enregistrés (défaut : fin de mois, virement).
    ...paiementDuBulletin(mois, p.variables),
  };
  const bulletin = calculerBulletin({ legal: ctx.legal, entreprise: ctx.entreprise, salarie: ctx.salarie, variables, periode: { debut: ctx.debut, fin: ctx.fin } });

  let pdf: Buffer;
  try {
    pdf = await genererBulletinPdf(donneesBulletinPdf({ ctx, bulletin, variables, organisation, employe, dossier }));
  } catch (e) {
    console.error("paie: rendu PDF impossible", e);
    return { ok: false, status: 500, error: "Échec de la génération du PDF." };
  }

  const filePath = `${appUser.organization_id}/${userId}/${randomUUID()}.pdf`;
  const { error: uploadError } = await supabase.storage.from("payslips").upload(filePath, pdf, { contentType: "application/pdf" });
  if (uploadError) return { ok: false, status: 500, error: `Échec de l'envoi du PDF : ${uploadError.message}` };

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
    if (error) return { ok: false, status: 500, error: error.message };
    if (ancien?.file_path) await supabase.storage.from("payslips").remove([ancien.file_path]);
    payslipId = ctx.bulletinExistant.id;
  } else {
    const { data, error } = await supabase
      .from("payslips")
      .insert({ ...row, organization_id: appUser.organization_id, user_id: userId, period_start: ctx.debut, period_end: ctx.fin })
      .select("id")
      .single();
    if (error) return { ok: false, status: 500, error: error.message };
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
    details: { salarie: userId, mois, regeneration: Boolean(ctx.bulletinExistant), par: appUser.role, acomptes: ctx.acomptes.ids.length, ...(p.lot ? { lot: true } : {}) },
  });

  // La direction qui génère elle-même valide dans la foulée (c'est elle qui
  // valide) ; un bulletin du comptable attend sa décision.
  let validation: "en_attente" | "valide" = "en_attente";
  if (p.validerSiDirection && appUser.role === "direction") {
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

  return { ok: true, id: payslipId, netAPayer: bulletin.netAPayer, validation };
}
