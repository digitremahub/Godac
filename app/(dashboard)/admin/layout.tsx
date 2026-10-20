import { LayoutSection } from "@/components/acces/OngletsSection";

/** Section Administration : Organisation, Abonnement & modules, Journal d'audit. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <LayoutSection section="admin">{children}</LayoutSection>;
}
