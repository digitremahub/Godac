import { SousOnglets } from "@/components/acces/OngletsSection";

/** Mon espace › Ma journée › Départ / Retour : départ, retour, saisie pour un collègue. */
export default function TourneeLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SousOnglets parent="moi.tournee_depart" libelle="Étapes de la tournée" />
      {children}
    </>
  );
}
