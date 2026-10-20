import { LayoutSection } from "@/components/acces/OngletsSection";

/** Section Flotte : Véhicules, Entretien, Loueurs, Amendes, Badges QR. */
export default function FlotteLayout({ children }: { children: React.ReactNode }) {
  return <LayoutSection section="flotte">{children}</LayoutSection>;
}
