import { SousOnglets } from "@/components/acces/OngletsSection";

/** Flotte › Loueurs : demandes aux loueurs, puis loueurs & prestataires. */
export default function LoueursLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SousOnglets parent="flotte.loueurs_demandes" libelle="Vues des loueurs" />
      {children}
    </>
  );
}
