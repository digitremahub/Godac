import { LayoutSection } from "@/components/acces/OngletsSection";

/** Mon espace en trois onglets : Ma journée, Mes documents, Mes demandes (lib/acces/catalogue.ts › GROUPES_MON_ESPACE). */
export default function MoiLayout({ children }: { children: React.ReactNode }) {
  return <LayoutSection section="moi">{children}</LayoutSection>;
}
