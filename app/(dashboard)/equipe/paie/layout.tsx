import { SousOnglets } from "@/components/acces/OngletsSection";
import { BandeauIndicatif } from "@/components/legal/BandeauIndicatif";

/** Équipe › Paie : bulletins du mois, heures & salaires, fiches de paie, réglages (remplace OngletsPaie). Note « document indicatif » en tête de chaque écran. */
export default function PaieLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SousOnglets parent="equipe.paie" libelle="Vues de la paie" />
      <BandeauIndicatif />
      {children}
    </>
  );
}
