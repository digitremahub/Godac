import "server-only";
import type { ContextePaie } from "@/lib/paie/donnees";
import type { BulletinPdfData } from "@/lib/paie/pdf";
import type { Bulletin, VariablesMois } from "@/lib/paie/types";

const CONTRATS: Record<string, string> = { cdi: "CDI", cdd: "CDD", interim: "Intérim", apprentissage: "Apprentissage" };
const jour = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC" });

export interface IdentitesBulletin {
  organisation: { name?: string | null; siret?: string | null; legal_address?: string | null; ape_code?: string | null; convention_collective?: string | null; urssaf_number?: string | null } | null;
  employe: { full_name: string; role_title?: string | null; address?: string | null };
  dossier: { matricule?: string | null; social_security_number?: string | null; hire_date?: string | null; contract_type?: string | null } | null;
}

/**
 * Données du PDF d'un bulletin (lib/paie/pdf.tsx) : en-tête employeur et
 * salarié, cumuls de l'année et pied (totaux, congés N-1 / N). Partagé par
 * la génération des bulletins (app/api/paie/bulletins) et la démo
 * (lib/demo/seed.ts), pour un rendu identique.
 */
export function donneesBulletinPdf(params: { ctx: ContextePaie; bulletin: Bulletin; variables: Pick<VariablesMois, "joursCongesPris"> } & IdentitesBulletin): BulletinPdfData {
  const { ctx, bulletin, variables, organisation, employe, dossier } = params;
  return {
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
      groupe: ctx.salarie.groupe ?? null,
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
    pied: {
      totaux: [
        { libelle: "Heures", mois: bulletin.heures.base + bulletin.heures.sup25 + bulletin.heures.sup50, annee: ctx.cumulsPied.heures + bulletin.heures.base + bulletin.heures.sup25 + bulletin.heures.sup50, heures: true },
        { libelle: "H. sup.", mois: bulletin.heures.sup25 + bulletin.heures.sup50, annee: ctx.cumulsPied.heuresSup + bulletin.heures.sup25 + bulletin.heures.sup50, heures: true },
        { libelle: "Brut", mois: bulletin.brut, annee: ctx.cumulsPied.brut + bulletin.brut },
        { libelle: "Plafond SS", mois: ctx.legal.pmss, annee: ctx.cumulsPied.plafondSs + ctx.legal.pmss },
        { libelle: "Net imposable", mois: bulletin.netImposable, annee: ctx.cumulsPied.netImposable + bulletin.netImposable },
        { libelle: "Ch. patronales", mois: bulletin.totalPatronal, annee: ctx.cumulsPied.chargesPatronales + bulletin.totalPatronal },
        { libelle: "Coût global", mois: bulletin.coutEmployeur, annee: ctx.cumulsPied.coutGlobal + bulletin.coutEmployeur },
        { libelle: "Total versé", mois: bulletin.netAPayer, annee: ctx.cumulsPied.totalVerse + bulletin.netAPayer },
        { libelle: "Allègements", mois: bulletin.reductionGenerale, annee: ctx.cumulsPied.allegements + bulletin.reductionGenerale },
      ],
      conges: { n1: ctx.conges.n1, n: ctx.conges.n },
    },
  };
}
