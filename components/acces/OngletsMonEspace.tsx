"use client";

import { usePathname } from "next/navigation";
import { Onglets, ongletActif } from "@/components/ui/Onglets";
import type { GroupeMonEspace } from "@/lib/acces/catalogue";

/**
 * Mon espace en trois onglets (Ma journée, Mes documents, Mes demandes),
 * puis les écrans de l'onglet actif en sous-onglets. Les URL de chaque
 * écran restent les mêmes : l'onglet actif se déduit du chemin.
 */
export function OngletsMonEspace({ groupes }: { groupes: GroupeMonEspace[] }) {
  const pathname = usePathname() ?? "";
  const actif = ongletActif(groupes, pathname) as GroupeMonEspace | undefined;
  return (
    <>
      {/* Un seul groupe (compte d'essai, comptable sans module…) : pas de barre à un onglet. */}
      <Onglets libelle="Onglets : Mon espace" onglets={groupes} />
      {actif && <Onglets variante="sous" libelle={actif.libelle} onglets={actif.onglets} />}
    </>
  );
}
