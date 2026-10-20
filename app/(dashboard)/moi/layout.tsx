import { LayoutSection } from "@/components/acces/OngletsSection";

/** Mon espace : tournée, planning, véhicule, amendes, fiches de paie, pointage, congés. */
export default function MoiLayout({ children }: { children: React.ReactNode }) {
  return <LayoutSection section="moi">{children}</LayoutSection>;
}
