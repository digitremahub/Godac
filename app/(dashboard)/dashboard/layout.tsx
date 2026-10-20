import { LayoutSection } from "@/components/acces/OngletsSection";

/** Section Tableau de bord : Aujourd'hui, Reporting BI (direction). */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <LayoutSection section="dashboard">{children}</LayoutSection>;
}
