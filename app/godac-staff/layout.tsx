import { NavigationStaff } from "@/components/godac-staff/NavigationStaff";

/** Cadre commun du back-office GODAC : barre de navigation fixe (l'accès est contrôlé page par page). */
export default function GodacStaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <NavigationStaff />
      {children}
    </>
  );
}
