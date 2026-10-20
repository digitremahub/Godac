import Link from "next/link";
import { etatLimite, type NiveauLimite } from "@/lib/acces/limites";

const COULEURS: Record<NiveauLimite, { barre: string; texte: string }> = {
  ok: { barre: "bg-teal", texte: "text-navy/65" },
  proche: { barre: "bg-gold", texte: "text-navy/75" },
  avertissement: { barre: "bg-orange", texte: "text-orange-ink" },
  bloque: { barre: "bg-red-600", texte: "text-red-700" },
};

/**
 * Jauge « utilisé / inclus » d'une limite de formule (véhicules) ou d'un
 * quota mensuel (OCR, assistant…), affichée là où la limite s'applique.
 * Réservée à l'encadrement : le chauffeur ne voit que le refus.
 */
export function JaugeQuota({
  libelle,
  utilise,
  inclus,
  unite,
  direction = false,
  compact = false,
  type = "limite",
}: {
  libelle: string;
  utilise: number;
  /** null = illimité : rien n'est affiché. */
  inclus: number | null;
  unite?: string;
  /** Affiche le lien « Changer de formule » quand la limite est atteinte. */
  direction?: boolean;
  compact?: boolean;
  /**
   * "limite" : limite de formule (véhicules), blocage au-delà de 110 % ;
   * "quota" : volume d'IA inclus par mois, au-delà facturé en dépassement
   * (ou refusé si l'entreprise l'a désactivé).
   */
  type?: "limite" | "quota";
}) {
  const etat = etatLimite(utilise, inclus);
  if (etat.inclus === null) return null;
  const pct = Math.min(100, Math.round((utilise / etat.inclus) * 100));
  const c = COULEURS[etat.niveau];
  const message =
    type === "quota"
      ? utilise >= etat.inclus
        ? "Volume inclus atteint : la suite est facturée en dépassement, ou refusée si le dépassement est désactivé."
        : etat.niveau === "proche"
          ? "Plus de 80 % du volume inclus ce mois."
          : null
      : etat.niveau === "bloque"
      ? `Limite dépassée : au-delà de ${etat.plafond}, l'ajout est bloqué.`
      : etat.niveau === "avertissement"
        ? `Limite de la formule atteinte (blocage à ${etat.plafond}).`
        : null;

  return (
    <div className={compact ? "min-w-[10rem]" : "rounded-xl border border-navy/10 bg-surface px-4 py-3"}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium text-navy/80">{libelle}</span>
        <span className={`tabular-nums font-semibold ${c.texte}`}>
          {utilise} / {etat.inclus}
          {unite ? ` ${unite}` : ""}
        </span>
      </div>
      <div
        className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-navy/[0.08]"
        role="meter"
        aria-label={libelle}
        aria-valuemin={0}
        aria-valuemax={etat.inclus}
        aria-valuenow={utilise}
      >
        <div className={`h-full rounded-full ${c.barre}`} style={{ width: `${pct}%` }} />
      </div>
      {message && !compact && (
        <p className={`mt-1.5 text-xs ${c.texte}`}>
          {message}{" "}
          {direction && (
            <Link href="/admin/abonnement" className="font-semibold underline">
              Changer de formule
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
