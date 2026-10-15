import { IconRamasse, IconMapPin } from "@/components/layout/icons";
import { TYPES_ARRET, type TypeArret } from "@/lib/colis/livraison";

/**
 * Encoche des ramasses : languette dorée sur le bord gauche de la carte
 * de l'arrêt. Le parent doit être `relative overflow-hidden` ; à placer
 * avec un BadgeRamasse pour que le type soit aussi lu par les lecteurs
 * d'écran (l'encoche seule est décorative).
 */
export function EncocheRamasse({ large = false }: { large?: boolean }) {
  return <span aria-hidden="true" className={`pointer-events-none absolute inset-y-0 left-0 bg-gold ${large ? "w-2" : "w-1.5"}`} />;
}

/** Étiquette « Ramasse » (icône + libellé), dorée, lisible en thème clair et sombre. */
export function BadgeRamasse({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-md bg-gold px-1.5 py-0.5 text-[11px] font-bold uppercase leading-none tracking-wide text-marine ${className}`}>
      <IconRamasse className="h-3.5 w-3.5" />
      Ramasse
    </span>
  );
}

/** Choix de la catégorie à la création ou l'édition d'un arrêt. */
export function ChoixTypeArret({ value, onChange }: { value: TypeArret; onChange: (t: TypeArret) => void }) {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-xl bg-navy/[0.05] p-1 text-xs font-semibold sm:text-sm" role="radiogroup" aria-label="Type d'arrêt">
      {TYPES_ARRET.map((t) => (
        <button
          key={t.key}
          type="button"
          role="radio"
          aria-checked={value === t.key}
          onClick={() => onChange(t.key)}
          className={`flex items-center justify-center gap-1.5 rounded-lg py-2 transition-colors ${
            value === t.key ? (t.key === "ramasse" ? "bg-gold text-marine shadow-card" : t.key === "point_relais" ? "bg-teal text-marine shadow-card" : "bg-surface shadow-card") : "text-navy/60 hover:text-navy"
          }`}
        >
          {t.key === "ramasse" && <IconRamasse className="h-4 w-4" />}
          {t.key === "point_relais" && <IconMapPin className="h-4 w-4" />}
          {t.label}
        </button>
      ))}
    </div>
  );
}
