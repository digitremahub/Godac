import { ICONES_STATUT_ELIGIBILITE, LIBELLES_STATUT_ELIGIBILITE, type StatutEligibilite } from "@/lib/ticpe/eligibilite";

const CLASSES: Record<StatutEligibilite, string> = { eligible: "badge-teal", a_verifier: "badge-gold", exclu: "badge-neutral" };

/** ✅ Éligible / ⚠️ À vérifier / ❌ Exclu (TICPE). */
export function BadgeEligibilite({ statut, prefixe = "TICPE" }: { statut: StatutEligibilite; prefixe?: string }) {
  return (
    <span className={CLASSES[statut]}>
      <span aria-hidden="true">{ICONES_STATUT_ELIGIBILITE[statut]}</span> {prefixe ? `${prefixe} : ` : ""}
      {LIBELLES_STATUT_ELIGIBILITE[statut].toLowerCase()}
    </span>
  );
}
