import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sexeValide, tempsPartiel, type EntreeRegistre } from "@/lib/registre/personnel";

type Ligne = Record<string, unknown>;
const texte = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Qualification : classification du dossier RH, sinon groupe et coefficient du profil de paie. */
function qualification(dossier: Ligne | undefined, profil: Ligne | undefined): string | null {
  const c = texte(dossier?.classification);
  if (c) return c;
  const parties = [texte(profil?.job_group) && `Groupe ${texte(profil?.job_group)}`, texte(profil?.coefficient) && `Coefficient ${texte(profil?.coefficient)}`].filter(Boolean);
  return parties.length ? parties.join(", ") : null;
}

export interface Registre {
  entrees: EntreeRegistre[];
  /** Comptes marqués « hors registre » (gérant non salarié, prestataire). */
  exclus: { userId: string; nom: string }[];
}

/**
 * Registre de l'organisation, lu avec le client de la direction (RLS).
 * Les colonnes de la migration 20261026000001 sont lues via select("*")
 * et la table employee_register_private de façon tolérante : le registre
 * s'affiche aussi avant son application (mentions signalées manquantes).
 */
export async function lireRegistre(supabase: SupabaseClient): Promise<Registre> {
  const [{ data: users }, { data: dossiers }, { data: prives }, { data: profils }] = await Promise.all([
    supabase.from("users").select("id, full_name, role_title, active, pending_approval"),
    supabase.from("employee_files").select("*"),
    supabase.from("employee_register_private").select("*"),
    supabase.from("payroll_profiles").select("*"),
  ]);
  const par = (rows: Ligne[] | null) => new Map((rows ?? []).map((r) => [r.user_id as string, r]));
  const dossierDe = par(dossiers as Ligne[] | null);
  const priveDe = par(prives as Ligne[] | null);
  const profilDe = par(profils as Ligne[] | null);

  const entrees: EntreeRegistre[] = [];
  const exclus: Registre["exclus"] = [];
  for (const u of users ?? []) {
    if (u.pending_approval) continue;
    const d = dossierDe.get(u.id);
    const p = priveDe.get(u.id);
    const pr = profilDe.get(u.id);
    if (d?.register_excluded === true) {
      exclus.push({ userId: u.id, nom: u.full_name });
      continue;
    }
    const sortieDossier = (d?.exit_date as string | null) ?? (d?.hr_status === "terminated" ? ((d?.contract_end_date as string | null) ?? null) : null);
    entrees.push({
      userId: u.id,
      nomAffiche: u.full_name,
      nom: texte(d?.last_name),
      prenoms: texte(d?.first_names),
      nationalite: texte(p?.nationality),
      dateNaissance: (d?.birth_date as string | null) ?? null,
      sexe: sexeValide(d?.sex),
      emploi: texte(u.role_title),
      qualification: qualification(d, pr),
      dateEntree: (d?.hire_date as string | null) ?? null,
      dateSortie: sortieDossier,
      typeContrat: texte(d?.contract_type),
      tempsPartiel: tempsPartiel(pr?.contractual_hours as number | null | undefined),
      agenceInterim: texte(d?.temp_agency),
      titreTravailType: texte(p?.work_permit_type),
      titreTravailNumero: texte(p?.work_permit_number),
      actif: Boolean(u.active),
    });
  }
  exclus.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  return { entrees, exclus };
}

export async function organisationPdf(supabase: SupabaseClient, organizationId: string) {
  const { data } = await supabase
    .from("organizations")
    .select("name, siret, legal_address, ape_code, convention_collective, urssaf_number, logo_url, accent_color")
    .eq("id", organizationId)
    .single();
  return data ?? null;
}
