import { LayoutSection } from "@/components/acces/OngletsSection";

/** Section Carburant : Pleins, Revue OCR, Cuves, Approvisionnements, TICPE. */
export default function CarburantLayout({ children }: { children: React.ReactNode }) {
  return <LayoutSection section="carburant">{children}</LayoutSection>;
}
