import { SousOnglets } from "@/components/acces/OngletsSection";

/** Équipe › Congés : demandes, puis calendrier. */
export default function CongesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SousOnglets parent="equipe.conges" libelle="Vues des congés" />
      {children}
    </>
  );
}
