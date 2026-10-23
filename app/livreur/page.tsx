import type { Metadata } from "next";
import { garderPage } from "@/lib/acces/garde-page";
import { AppLivreur } from "@/components/colis/AppLivreur";
import { paysOrganisation } from "@/lib/pays/serveur";
import { lireEtatOffre } from "@/lib/go-navigation/etat";
import { EssaiTermine } from "@/components/go-navigation/EssaiTermine";

export const metadata: Metadata = { title: "Ma tournée colis — GODAC" };

/**
 * « Ma tournée colis » : point d'entrée unique du conducteur (menu, barre
 * mobile, accueil, application installée). Plein écran, hors du tableau
 * de bord (pas de menu) pour rester lisible au volant : Préparer →
 * Démarrer → Livrer → Clôturer (lib/colis/parcours.ts).
 *
 * Garde du catalogue (moi.tournee_colis) : l'encadrement qui ne conduit
 * pas est renvoyé vers la préparation et l'affectation
 * (/exploitation/colis), un autre rôle voit le refus expliqué.
 */
export default async function LivreurPage() {
  const g = await garderPage("moi.tournee_colis");
  if (!g.ok) return <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center bg-paper p-6">{g.ecran}</main>;
  const { appUser, supabase } = g;
  const offre = await lireEtatOffre(supabase, appUser.organization_id);
  if (offre.essaiTermine) return <EssaiTermine />;
  const pays = await paysOrganisation(supabase, appUser.organization_id);
  return <AppLivreur prenom={appUser.full_name.split(" ")[0] || null} pays={pays.code} recommander={offre.goNavigation} />;
}
