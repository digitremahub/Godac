import { LayoutSection } from "@/components/acces/OngletsSection";

/** Section Communication : Messenger, Intranet & convocations, Alertes, Assistance. */
export default function CommunicationLayout({ children }: { children: React.ReactNode }) {
  return <LayoutSection section="communication">{children}</LayoutSection>;
}
