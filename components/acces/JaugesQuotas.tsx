import "server-only";
import type { UserRole } from "@/lib/types/domain";
import type { UsageFeature } from "@/lib/usage/quotas";
import { etatQuotas, LIBELLES_JAUGE } from "@/lib/usage/etat-quotas";
import { JaugeQuota } from "@/components/acces/JaugeQuota";

/**
 * Jauges des quotas d'IA du mois, à l'endroit où ils s'appliquent.
 * Réservées à l'encadrement (le chauffeur ne voit que le refus).
 * `seuil` : n'afficher qu'au-delà de ce pourcentage (ex. 80 pour l'assistant).
 */
export async function JaugesQuotas({
  organizationId,
  role,
  fonctions,
  seuil = 0,
  className = "mb-4 flex flex-wrap gap-3",
}: {
  organizationId: string;
  role: UserRole;
  fonctions: readonly UsageFeature[];
  seuil?: number;
  className?: string;
}) {
  if (!["direction", "manager"].includes(role)) return null;
  const etats = (await etatQuotas(organizationId, fonctions)).filter((e) => e.inclus !== null && e.inclus > 0 && (e.utilise / e.inclus) * 100 >= seuil);
  if (etats.length === 0) return null;
  return (
    <div className={className}>
      {etats.map((e) => (
        <div key={e.fonction} className="min-w-[14rem] flex-1 sm:max-w-xs">
          <JaugeQuota libelle={LIBELLES_JAUGE[e.fonction]} utilise={e.utilise} inclus={e.inclus} type="quota" direction={role === "direction"} />
        </div>
      ))}
    </div>
  );
}
