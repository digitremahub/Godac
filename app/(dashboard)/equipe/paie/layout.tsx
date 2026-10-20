import { SousOnglets } from "@/components/acces/OngletsSection";

/** Équipe › Paie : bulletins du mois, heures & salaires, fiches de paie, réglages (remplace OngletsPaie). */
export default function PaieLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SousOnglets parent="equipe.paie" libelle="Vues de la paie" />
      {children}
    </>
  );
}
