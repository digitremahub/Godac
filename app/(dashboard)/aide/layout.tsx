import { LayoutSection } from "@/components/acces/OngletsSection";

/** Section Aide : Guide d'utilisation, Questions fréquentes. */
export default function AideLayout({ children }: { children: React.ReactNode }) {
  return <LayoutSection section="aide">{children}</LayoutSection>;
}
