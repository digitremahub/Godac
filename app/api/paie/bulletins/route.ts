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
import { variablesSchema } from "@/lib/paie/schemas";

export const maxDuration = 60;

const bodySchema = z.object({ user_id: z.string().uuid(), mois: z.string(), variables: variablesSchema });

const CONTRATS: Record<string, string> = { cdi: "CDI", cdd: "CDD", interim: "Intérim", apprentissage: "Apprentissage" };
const jour = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC" });

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
    supabase.from("organizations").select("name, siret, legal_address, ape_code, convention_collective, urssaf_number").eq("id", appUser.organization_id).single(),
    supabase.from("employee_files").select("matricule, social_security_number, hire_date, contract_type").eq("user_id", userId).maybeSingle(),
  ]);
  if (!employe) return NextResponse.json({ error: "Salarié introuvable." }, { status: 404 });

  const ctx = await contextePaie(supabase, appUser.organization_id, userId, mois);
  if (!ctx.profilComplet) return NextResponse.json({ error: "Renseignez d'abord le profil de paie (taux horaire, heures) de ce salarié." }, { status: 422 });

  const variables = { ...parsed.data.variables, cumulHeuresSupExonereesAnnee: ctx.cumuls.heuresSupExonerees };
  const bulletin = calculerBulletin({ legal: ctx.legal, entreprise: ctx.entreprise, salarie: ctx.salarie, variables });

  let pdf: Buffer;
  try {
    pdf = await genererBulletinPdf({
      bulletin,
      periode: new Date(`${ctx.debut}T12:00:00Z`).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }),
      dateEdition: new Date().toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }),
      employeur: {
        nom: organisation?.name ?? "Entreprise",
        adresse: organisation?.legal_address ?? null,
        siret: organisation?.siret ?? null,
        ape: organisation?.ape_code ?? null,
        urssaf: organisation?.urssaf_number ?? null,
        convention: organisation?.convention_collective ?? null,
      },
      salarie: {
        nom: employe.full_name,
        adresse: employe.address ?? null,
        emploi: employe.role_title ?? null,
        matricule: dossier?.matricule ?? null,
        secu: dossier?.social_security_number ?? null,
        coefficient: ctx.coefficient,
        statut: ctx.salarie.cadre ? "Cadre" : "Non-cadre",
        entree: dossier?.hire_date ? jour(dossier.hire_date) : null,
        contrat: dossier?.contract_type ? (CONTRATS[dossier.contract_type] ?? dossier.contract_type) : null,
      },
      cumuls: {
        brut: ctx.cumuls.brut + bulletin.brut,
        netImposable: ctx.cumuls.netImposable + bulletin.netImposable,
        heuresSupExonerees: ctx.cumuls.heuresSupExonerees + bulletin.heuresSupExonerees,
      },
      conges: { pris: variables.joursCongesPris },
    });
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

  await journaliser({
    organizationId: appUser.organization_id,
    userId: appUser.id,
    action: "paie_bulletin_genere",
    targetTable: "payslips",
    targetId: payslipId,
    details: { salarie: userId, mois, regeneration: Boolean(ctx.bulletinExistant), par: appUser.role },
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
