import { Card } from "@/components/ui";
import { IconAlertTriangle, IconCheck } from "@/components/layout/icons";
import { miseEnPlace } from "@/lib/organization/idcc";
import type { Pays } from "@/lib/pays/pays";

/**
 * « Ce que GODAC a mis en place » à partir du SIRET : convention
 * collective, règles de paie, durées d'équivalence, frais, effectif,
 * règles du pays. Les lignes « attention » sont à voir avec
 * l'expert-comptable (autre convention que l'IDCC 16, aucune déclarée…).
 */
export function MiseEnPlaceCard({
  idcc,
  pays,
  libelleEffectif,
  effectif,
  className = "",
}: {
  idcc: string[];
  pays: Pays;
  libelleEffectif?: string | null;
  effectif?: number | null;
  className?: string;
}) {
  const lignes = miseEnPlace({ idcc, pays, libelleEffectif, effectif });
  return (
    <Card className={`flex flex-col gap-3 ${className}`}>
      <div>
        <h3 className="text-lg">Ce que GODAC a mis en place</h3>
        <p className="text-sm text-navy/65">D&apos;après le SIRET de l&apos;entreprise et sa convention collective déclarée.</p>
      </div>
      <ul className="flex flex-col gap-2.5">
        {lignes.map((l) => (
          <li key={l.titre} className="flex gap-2.5 text-sm">
            {l.ton === "ok" ? (
              <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-ink" />
            ) : (
              <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-ink" />
            )}
            <div>
              <p className="font-medium">{l.titre}</p>
              <p className="text-navy/70">{l.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
