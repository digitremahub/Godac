import { utilisateurCourant } from "@/lib/acces/modules-requete";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { couleursOrganisation } from "@/lib/theme/couleurs-entreprise-serveur";
import { StyleCouleursEntreprise } from "@/components/layout/StyleCouleursEntreprise";
import { SynchroHorsLigne } from "@/components/offline/SynchroHorsLigne";

/** Écrans plein écran du conducteur (/livreur, GO Navigation) : couleurs de l'entreprise et vidage de la file hors ligne. */
export default async function LivreurLayout({ children }: { children: React.ReactNode }) {
  const appUser = await utilisateurCourant();
  const couleurs = appUser ? await couleursOrganisation(await createServerSupabaseClient(), appUser.organization_id) : null;
  return (
    <>
      <StyleCouleursEntreprise couleurs={couleurs} />
      <SynchroHorsLigne />
      {children}
    </>
  );
}
