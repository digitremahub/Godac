import { IconPointRelais, IconRamasse } from "@/components/layout/icons";
import { TYPES_ARRET, estPointRelais, estRamasse, type TypeArret } from "@/lib/colis/livraison";

/**
 * Encoche des ramasses : languette dorée sur le bord gauche de la carte
 * de l'arrêt. Le parent doit être `relative overflow-hidden` ; à placer
 * avec un BadgeRamasse pour que le type soit aussi lu par les lecteurs
 * d'écran (l'encoche seule est décorative).
 */
export function EncocheRamasse({ large = false }: { large?: boolean }) {
  return <span aria-hidden="true" className={`pointer-events-none absolute inset-y-0 left-0 bg-gold ${large ? "w-2" : "w-1.5"}`} />;
}

/**
 * Encoche des points relais : même languette que la ramasse, en violet et
 * crantée (motif rayé) pour rester distincte même sans les couleurs.
 */
export function EncochePointRelais({ large = false }: { large?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute inset-y-0 left-0 bg-relais ${large ? "w-2" : "w-1.5"}`}
      style={{ backgroundImage: "repeating-linear-gradient(180deg, transparent 0 6px, rgba(10,15,30,.28) 6px 8px)" }}
    />
  );
}

/** Étiquette « Ramasse » (icône + libellé), dorée, lisible en thème clair et sombre. */
export function BadgeRamasse({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-md bg-gold px-1.5 py-0.5 text-[11px] font-bold uppercase leading-none tracking-wide text-marine-fixe ${className}`}>
      <IconRamasse className="h-3.5 w-3.5" />
      Ramasse
    </span>
  );
}

/** Étiquette « Point relais » (icône devanture + libellé), violette, suivie du nom du relais s'il est connu. */
export function BadgePointRelais({ nom, className = "" }: { nom?: string | null; className?: string }) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${className}`}>
      <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-relais px-1.5 py-0.5 text-[11px] font-bold uppercase leading-none tracking-wide text-marine-fixe">
        <IconPointRelais className="h-3.5 w-3.5" />
        Point relais
      </span>
      {nom && <span className="truncate text-xs font-semibold normal-case tracking-normal text-relais-ink">{nom}</span>}
    </span>
  );
}

type ArretType = { kind?: string | null; relay_name?: string | null };

/** Encoche selon le type d'arrêt (rien pour une livraison). */
export function EncocheArret({ stop, large = false }: { stop: ArretType; large?: boolean }) {
  if (estRamasse(stop)) return <EncocheRamasse large={large} />;
  if (estPointRelais(stop)) return <EncochePointRelais large={large} />;
  return null;
}

/** Étiquette selon le type d'arrêt (rien pour une livraison). */
export function BadgeArret({ stop, className = "" }: { stop: ArretType; className?: string }) {
  if (estRamasse(stop)) return <BadgeRamasse className={className} />;
  if (estPointRelais(stop)) return <BadgePointRelais nom={stop.relay_name} className={className} />;
  return null;
}

/** Bordure de la carte de l'arrêt en cours selon son type. */
export const bordureArret = (stop: ArretType, defaut = "border-teal/60") => (estRamasse(stop) ? "border-gold/80" : estPointRelais(stop) ? "border-relais/80" : defaut);

/** Choix Livraison / Ramasse / Point relais à la création ou l'édition d'un arrêt. */
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
            value === t.key
              ? t.key === "ramasse"
                ? "bg-gold text-marine-fixe shadow-card"
                : t.key === "point_relais"
                  ? "bg-relais text-marine-fixe shadow-card"
                  : "bg-surface shadow-card"
              : "text-navy/60 hover:text-navy"
          }`}
        >
          {t.key === "ramasse" && <IconRamasse className="h-4 w-4" />}
          {t.key === "point_relais" && <IconPointRelais className="h-4 w-4" />}
          {t.label}
        </button>
      ))}
    </div>
  );
}
