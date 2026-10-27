import Link from "next/link";
import { urlDe } from "@/lib/acces/catalogue";
import { ecranOuvrable } from "@/lib/acces/tuiles-accueil";
import type { UserRole } from "@/lib/types/domain";

const RACCOURCIS = [
  { ecran: "exploitation.en_cours", libelle: "Tournées en cours" },
  { ecran: "exploitation.cloture", libelle: "Clôture du jour" },
] as const;

/** Liens de l'accueil vers la vue des tournées en cours et la clôture du soir, selon le catalogue des accès (jamais un écran refusé). Pastilles compactes sur une ligne défilable. */
export function RaccourcisJournee({ role, modules, conduit }: { role: UserRole; modules: ReadonlySet<string>; conduit: boolean }) {
  const liens = RACCOURCIS.filter((r) => ecranOuvrable(r.ecran, { role, modules, conduit }));
  if (liens.length === 0) return null;
  return (
    <nav aria-label="Raccourcis de la journée" className="mb-3 flex gap-2 overflow-x-auto">
      {liens.map((l) => (
        <Link key={l.ecran} href={urlDe(l.ecran)} className="btn-secondary inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap text-sm">
          {l.libelle}
        </Link>
      ))}
    </nav>
  );
}
