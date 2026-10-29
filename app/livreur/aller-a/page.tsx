import type { Metadata } from "next";
import { garderPage } from "@/lib/acces/garde-page";
import { AllerA } from "@/components/go-aller-a/AllerA";
import { lireEtatOffre } from "@/lib/go-navigation/etat";
import { EssaiTermine } from "@/components/go-navigation/EssaiTermine";

export const metadata: Metadata = { title: "Aller à… — GODAC" };

/**
 * « Aller à… » : navigation GO vers une destination libre, sans tournée.
 * Même garde que « Ma tournée colis » (rôle qui conduit, module Tournée
 * colis, compte non suspendu ; essai terminé = écran dédié).
 */
export default async function AllerAPage() {
  const g = await garderPage("moi.tournee_colis");
  if (!g.ok) return <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center bg-paper p-6">{g.ecran}</main>;
  if ((await lireEtatOffre(g.supabase, g.appUser.organization_id)).essaiTermine) return <EssaiTermine />;
  return <AllerA />;
}
