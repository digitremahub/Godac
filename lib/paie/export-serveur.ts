import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bornesMois, contextePaie } from "@/lib/paie/donnees";
import { controlesExport, salariesDuMois, type BulletinExport, type Controle, type SalarieExport } from "@/lib/paie/export-comptable";
import { ligneJournal, totauxJournal, type LigneJournal, type TotauxJournal } from "@/lib/paie/journal";
import { papierDemande } from "@/lib/paie/remise-electronique";
import { LIBELLES_VALIDATION, statutValide } from "@/lib/paie/validation";
import type { Bulletin, VariablesMois } from "@/lib/paie/types";

export interface DonneesMois {
  mois: string;
  debut: string;
  fin: string;
  /** Libellé « septembre 2026 ». */
  libelle: string;
  salaries: SalarieExport[];
  bulletins: BulletinExport[];
  controles: Controle[];
  journal: LigneJournal[];
  totaux: TotauxJournal;
}

/**
 * Données du mois pour l'export comptable et le journal de paie, lues
 * avec le client de l'utilisateur (RLS : direction et comptable). La
 * préférence de remise (payslip_delivery_preferences, migration
 * 20261026000001) est lue de façon tolérante : table absente = aucune
 * opposition connue.
 */
export async function donneesMois(supabase: SupabaseClient, mois: string): Promise<DonneesMois> {
  const { debut, fin } = bornesMois(mois);
  const [{ data: users }, { data: dossiers }, { data: profils }, { data: payslips }, { data: preferences }] = await Promise.all([
    supabase.from("users").select("id, full_name, role_title, active, pending_approval").order("full_name"),
    supabase.from("employee_files").select("user_id, matricule"),
    supabase.from("payroll_profiles").select("user_id, coefficient"),
    supabase
      .from("payslips")
      .select("id, user_id, validation_status, gross_amount, net_amount, details, variables")
      .eq("period_start", debut)
      .eq("period_end", fin),
    supabase.from("payslip_delivery_preferences").select("user_id, paper_requested, decided_at"),
  ]);
  const matricule = new Map((dossiers ?? []).map((d) => [d.user_id as string, (d.matricule as string | null) ?? null]));
  const coefficient = new Map((profils ?? []).map((p) => [p.user_id as string, (p.coefficient as string | null) ?? null]));
  const preference = new Map((preferences ?? []).map((p) => [p.user_id as string, p as { paper_requested: boolean; decided_at: string }]));

  const tous: SalarieExport[] = (users ?? [])
    .filter((u) => !u.pending_approval)
    .map((u) => ({
      id: u.id as string,
      nom: u.full_name as string,
      emploi: (u.role_title as string | null) ?? null,
      matricule: matricule.get(u.id) ?? null,
      coefficient: coefficient.get(u.id) ?? null,
      actif: Boolean(u.active),
      papierDemande: papierDemande(preference.get(u.id)),
    }));
  const bulletins: BulletinExport[] = (payslips ?? []).map((p) => ({
    id: p.id as string,
    user_id: p.user_id as string,
    validation_status: (p.validation_status as string | null) ?? null,
    gross_amount: p.gross_amount as number | null,
    net_amount: p.net_amount as number | null,
    details: (p.details as Bulletin | null) ?? null,
    variables: (p.variables as VariablesMois | null) ?? null,
  }));
  const salaries = salariesDuMois(tous, bulletins);
  const de = new Map(salaries.map((s) => [s.id, s]));
  const journal = bulletins
    .filter((b) => b.details && de.has(b.user_id))
    .map((b) => {
      const s = de.get(b.user_id)!;
      return ligneJournal({ id: s.id, nom: s.nom, matricule: s.matricule }, { validation_status: b.validation_status, details: b.details! });
    })
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));

  return {
    mois,
    debut,
    fin,
    libelle: new Date(`${debut}T12:00:00Z`).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }),
    salaries,
    bulletins,
    controles: controlesExport(salaries, bulletins),
    journal,
    totaux: totauxJournal(journal),
  };
}

/**
 * Éléments variables du mois : ceux du bulletin quand il existe, sinon le
 * préremplissage GODAC (tournées, congés validés, acomptes acceptés), à
 * vérifier par le comptable.
 */
export async function variablesDuMois(
  supabase: SupabaseClient,
  organizationId: string,
  d: DonneesMois,
): Promise<{ salarie: SalarieExport; variables: VariablesMois | null; source: string }[]> {
  const de = new Map(d.bulletins.map((b) => [b.user_id, b]));
  const lignes = [];
  for (const s of d.salaries) {
    const b = de.get(s.id);
    if (b?.variables) {
      lignes.push({ salarie: s, variables: b.variables, source: `Bulletin GODAC (${LIBELLES_VALIDATION[statutValide(b.validation_status)].toLowerCase()})` });
      continue;
    }
    try {
      const ctx = await contextePaie(supabase, organizationId, s.id, d.mois);
      const { joursTravailles: _jours, ...variables } = ctx.prefill;
      void _jours;
      lignes.push({ salarie: s, variables, source: "Préremplissage GODAC (à vérifier)" });
    } catch {
      lignes.push({ salarie: s, variables: null, source: "Aucune donnée" });
    }
  }
  return lignes;
}
