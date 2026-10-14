import { IconAlertTriangle, IconPhone } from "@/components/layout/icons";
import { ALERTE_SANS_TELEPHONE } from "@/lib/colis/telephone";

/** Étiquette « Sans téléphone » d'un arrêt à faire : le chauffeur ne pourra pas appeler le client. */
export function BadgeSansTelephone({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-md bg-orange/15 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-orange-ink ${className}`}
      title={ALERTE_SANS_TELEPHONE}
    >
      <IconPhone className="h-3 w-3" />
      Sans téléphone
    </span>
  );
}

/** Avertissement dans la fiche d'ajout d'un colis sans numéro (n'empêche pas l'ajout). */
export function AlerteSansTelephone() {
  return (
    <p role="status" className="flex items-start gap-2 rounded-lg bg-orange/10 px-3 py-2 text-sm font-semibold text-orange-ink">
      <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      {ALERTE_SANS_TELEPHONE}
    </p>
  );
}
