import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { estSuspendue } from "@/lib/comptes-essai/regles";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";

/**
 * Le compte de la personne connectée est-il suspendu par GODAC ?
 *
 * L'ACCÈS est refusé par getCurrentAppUser() (lib/auth/session.ts), qui rend
 * null pour un compte suspendu. Cette fonction ne sert qu'à CHOISIR LE
 * MESSAGE quand getCurrentAppUser() a rendu null : « Compte suspendu par
 * GODAC » plutôt que « Session expirée » ou l'écran d'inscription. Elle ne
 * donne jamais accès à rien et ne lève jamais d'erreur (null en cas de doute).
 */
export async function compteSuspenduDeLUtilisateurCourant(): Promise<boolean> {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;
    return await compteSuspenduPour(user.id);
  } catch {
    return false;
  }
}

/** Même contrôle pour un identifiant de connexion donné (client service : la personne n'a pas besoin de lire sa ligne). */
export async function compteSuspenduPour(userId: string): Promise<boolean> {
  try {
    const admin = createAdminSupabaseClient();
    const { data: profil } = await admin.from("users").select("organization_id").eq("id", userId).maybeSingle();
    const organizationId = (profil as { organization_id?: string } | null)?.organization_id;
    if (!organizationId) return false;
    return await organisationSuspendueAdmin(organizationId, false);
  } catch {
    return false;
  }
}

/**
 * Organisation suspendue ? (client service). `siDoute` : valeur rendue quand
 * la lecture échoue pour une autre raison qu'une migration absente — vrai
 * pour une garde (fail-closed), faux pour un simple choix de message.
 */
export async function organisationSuspendueAdmin(organizationId: string, siDoute: boolean): Promise<boolean> {
  try {
    const { data, error } = await createAdminSupabaseClient().from("organizations").select("suspendue_le").eq("id", organizationId).maybeSingle();
    if (error) return estSchemaManquant(error) ? false : siDoute;
    return estSuspendue(data as { suspendue_le?: string | null } | null);
  } catch {
    return siDoute;
  }
}
