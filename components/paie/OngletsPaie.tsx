import Link from "next/link";

export type OngletPaie = "bulletins" | "salaires" | "fiches" | "reglages";

/**
 * Paie, salaires et fiches de paie réunis en une seule page pour la
 * direction : un onglet par vue, chacune gardant sa propre adresse.
 * L'onglet Bulletins / Réglages n'apparaît que si le module Fiches de paie
 * est actif ; Heures & salaires dépend du planning.
 */
export function OngletsPaie({ actif, paie, planning }: { actif: OngletPaie; paie: boolean; planning: boolean }) {
  const onglets: { cle: OngletPaie; href: string; label: string; visible: boolean }[] = [
    { cle: "bulletins", href: "/paie", label: "Bulletins du mois", visible: paie },
    { cle: "salaires", href: "/payroll", label: "Heures & salaires", visible: planning },
    { cle: "fiches", href: "/payslips", label: "Fiches de paie", visible: paie },
    { cle: "reglages", href: "/paie/parametres", label: "Réglages", visible: paie },
  ];
  const visibles = onglets.filter((o) => o.visible);
  if (visibles.length < 2) return null;
  return (
    <nav aria-label="Paie et salaires" className="mb-5 flex gap-1 overflow-x-auto border-b border-navy/10">
      {visibles.map((o) => (
        <Link
          key={o.cle}
          href={o.href}
          aria-current={o.cle === actif ? "page" : undefined}
          className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
            o.cle === actif ? "border-teal text-navy" : "border-transparent text-navy/55 hover:text-navy"
          }`}
        >
          {o.label}
        </Link>
      ))}
    </nav>
  );
}
