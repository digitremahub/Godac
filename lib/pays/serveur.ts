import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { paysDe, type Pays } from "@/lib/pays/pays";

/** Pays de l'organisation connectée (France si non renseigné). */
export async function paysOrganisation(supabase: SupabaseClient, organizationId: string): Promise<Pays> {
  const { data } = await supabase.from("organizations").select("country").eq("id", organizationId).maybeSingle();
  return paysDe(data?.country as string | undefined);
}

/** Message affiché quand le moteur de paie ne couvre pas le pays de l'entreprise. */
export const paieIndisponible = (p: Pays) =>
  `Le calcul des bulletins de paie GODAC suit le droit français. Pour une entreprise en ${p.nom}, les bulletins sont établis par votre gestionnaire de paie (${p.paie.organismes}) : GODAC lui fournit les heures (page Salaires), les congés et absences.`;

/** Code pays de l'organisation, pour le géocodage des adresses (lib/geo/geocode.ts). */
export async function codePays(organizationId: string): Promise<string> {
  const { createServerSupabaseClient } = await import("@/lib/supabase/server");
  return (await paysOrganisation(await createServerSupabaseClient(), organizationId)).code;
}
