import "server-only";
import { redirect } from "next/navigation";
import { ongletsSection, premierOngletSection, sousOnglets, SECTIONS, type SectionId } from "@/lib/acces/catalogue";
import { modulesActifs, utilisateurCourant } from "@/lib/acces/modules-requete";
import { Onglets } from "@/components/ui/Onglets";

/**
 * Barre d'onglets d'une section, calculée côté serveur depuis le
 * catalogue (rôle + modules, partagés avec la garde de page par le cache
 * de requête). Un layout serveur ne connaît pas le chemin courant :
 * l'onglet actif est déterminé dans le composant client <Onglets>.
 */
export async function OngletsSection({ section }: { section: SectionId }) {
  const appUser = await utilisateurCourant();
  if (!appUser) return null;
  const modules = await modulesActifs(appUser.organization_id);
  const onglets = ongletsSection(section, appUser.role, modules);
  const libelle = SECTIONS.find((s) => s.id === section)?.libelle ?? section;
  return <Onglets libelle={`Onglets : ${libelle}`} onglets={onglets} />;
}

/** Sous-onglets d'un écran parent (Paie, Historique, Loueurs…). */
export async function SousOnglets({ parent, libelle }: { parent: string; libelle: string }) {
  const appUser = await utilisateurCourant();
  if (!appUser) return null;
  const modules = await modulesActifs(appUser.organization_id);
  return <Onglets variante="sous" libelle={libelle} onglets={sousOnglets(parent, appUser.role, modules)} />;
}

/** Layout commun d'une section : barre d'onglets puis la page. */
export function LayoutSection({ section, children }: { section: SectionId; children: React.ReactNode }) {
  return (
    <>
      <OngletsSection section={section} />
      {children}
    </>
  );
}

/** URL nue d'une section (/flotte…) : premier onglet ouvrable, sinon l'accueil. */
export async function redirigerSection(section: SectionId): Promise<never> {
  const appUser = await utilisateurCourant();
  if (!appUser) redirect("/onboarding");
  const modules = await modulesActifs(appUser.organization_id);
  redirect(premierOngletSection(section, appUser.role, modules) ?? "/dashboard");
}
