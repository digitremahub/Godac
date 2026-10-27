import { LayoutSection } from "@/components/acces/OngletsSection";
import { BandeauIndicatif } from "@/components/legal/BandeauIndicatif";

/** Section Carburant : Pleins, Revue OCR, Cuves, Approvisionnements, TICPE. Note « document indicatif » en tête de chaque écran. */
export default function CarburantLayout({ children }: { children: React.ReactNode }) {
  return (
    <LayoutSection section="carburant">
      <BandeauIndicatif />
      {children}
    </LayoutSection>
  );
}
