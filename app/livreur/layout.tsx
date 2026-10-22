import { utilisateurCourant } from "@/lib/acces/modules-requete";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { couleursOrganisation } from "@/lib/theme/couleurs-entreprise-serveur";
import { StyleCouleursEntreprise } from "@/components/layout/StyleCouleursEntreprise";

/** Écrans plein écran du conducteur (/livreur, GO Navigation) : couleurs de l'entreprise. */
export default async function LivreurLayout({ children }: { children: React.ReactNode }) {
  const appUser = await utilisateurCourant();
  const couleurs = appUser ? await couleursOrganisation(await createServerSupabaseClient(), appUser.organization_id) : null;
  return (
    <>
      <StyleCouleursEntreprise couleurs={couleurs} />
      {children}
    </>
  );
}
