import Link from "next/link";
import { addMonths } from "@/lib/planning/dates";

/** Mois précédent / suivant d'un écran de paie. */
export function NavigationMois({ base, mois, libelle }: { base: string; mois: string; libelle: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <Link href={`${base}?mois=${addMonths(mois, -1)}`} className="btn-secondary !px-3 !py-1.5 text-sm">
        ← Préc.
      </Link>
      <span className="text-sm font-semibold capitalize">{libelle}</span>
      <Link href={`${base}?mois=${addMonths(mois, 1)}`} className="btn-secondary !px-3 !py-1.5 text-sm">
        Suiv. →
      </Link>
    </div>
  );
}
