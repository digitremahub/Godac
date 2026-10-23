import { Card, EmptyState } from "@/components/ui";
import { LIBELLE_STATUT_ARRET, dateCourte, libelleTypeArret, nbJours } from "@/lib/arrets/declaration";
import type { LigneArret } from "@/lib/arrets/serveur";

const BADGE: Record<LigneArret["statut"], string> = { recu: "badge-gold", valide: "badge-teal", refuse: "badge-orange" };

/** Mes arrêts : période, statut, motif d'un refus, photos jointes. */
export function ListeMesArrets({ arrets, liens, libelleAttente }: { arrets: LigneArret[]; liens: Map<string, string>; libelleAttente?: string }) {
  if (arrets.length === 0) return <EmptyState title="Aucun arrêt de travail enregistré" />;
  return (
    <div className="flex flex-col gap-2">
      {arrets.map((a) => (
        <Card key={a.id} className="flex flex-col gap-1.5 !p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">
              Du {dateCourte(a.du)} au {dateCourte(a.au)} <span className="font-normal text-navy/60">· {nbJours(a.du, a.au)} j</span>
            </span>
            <span className={BADGE[a.statut]}>{a.statut === "recu" && libelleAttente ? libelleAttente : LIBELLE_STATUT_ARRET[a.statut]}</span>
          </div>
          <span className="text-navy/70">
            {libelleTypeArret(a.type)}
            {a.extensionOf ? ` · prolongation (arrêt initial du ${dateCourte(a.extensionOf)})` : ""}
          </span>
          {a.statut === "refuse" && a.motifRefus && <span className="text-orange-ink">Motif : {a.motifRefus}</span>}
          {a.documents.length > 0 && (
            <span className="flex flex-wrap gap-3">
              {a.documents.map((d, i) =>
                liens.get(d) ? (
                  <a key={d} href={liens.get(d)} target="_blank" rel="noreferrer" className="text-teal-ink underline">
                    Avis {a.documents.length > 1 ? i + 1 : ""}
                  </a>
                ) : null,
              )}
            </span>
          )}
        </Card>
      ))}
    </div>
  );
}
