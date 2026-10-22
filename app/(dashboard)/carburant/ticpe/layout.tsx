import { SousOnglets } from "@/components/acces/OngletsSection";

/** Carburant › TICPE : tableau de bord, à régler, véhicules, documents, réglages. */
export default function TicpeLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SousOnglets parent="carburant.ticpe" libelle="Vues TICPE" />
      {children}
    </>
  );
}
