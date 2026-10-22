import { periodeContenant, periodePrecedente, type PeriodeDeclaration } from "@/lib/ticpe/echeances";
import type { RegimeTva } from "@/lib/ticpe/reglages";

/** Choix d'une période de déclaration (formulaire GET, sans JavaScript). */
export function SelecteurPeriode({ action, regime, courante, aujourdhui, nombre = 30 }: { action: string; regime: RegimeTva; courante: PeriodeDeclaration; aujourdhui: string; nombre?: number }) {
  const options: PeriodeDeclaration[] = [];
  let p = periodeContenant(aujourdhui, regime);
  for (let i = 0; i < nombre && p.debut >= "2025-01-01"; i++) {
    options.push(p);
    p = periodePrecedente(p, regime);
  }
  if (!options.some((o) => o.cle === courante.cle)) options.unshift(courante);
  return (
    <form method="get" action={action} className="mb-4 flex flex-wrap items-end gap-2 text-sm">
      <label className="block">
        <span className="label">Période</span>
        <select name="periode" defaultValue={courante.cle} className="input !w-auto">
          {options.map((o) => (
            <option key={o.cle} value={o.cle}>
              {o.libelle}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="btn-secondary !px-3 !py-2">
        Afficher
      </button>
    </form>
  );
}
