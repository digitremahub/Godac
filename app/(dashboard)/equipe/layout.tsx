import { LayoutSection } from "@/components/acces/OngletsSection";

/** Section Équipe & RH : Utilisateurs, Inscriptions, Pointage, Congés, Paie. */
export default function EquipeLayout({ children }: { children: React.ReactNode }) {
  return <LayoutSection section="equipe">{children}</LayoutSection>;
}
