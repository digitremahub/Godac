import { garderPage } from "@/lib/acces/garde-page";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { NavigationMois } from "@/components/paie/NavigationMois";
import { moisValide } from "@/lib/paie/donnees";
import { donneesMois } from "@/lib/paie/export-serveur";
import { currentMonth } from "@/lib/planning/dates";

/**
 * Équipe › Paie › Export comptable (direction, comptable) : le mois en
 * CSV pour le comptable, qui dépose la DSN. Les contrôles s'affichent en
 * avertissement ; ils ne bloquent pas l'export.
 */
export default async function ExportPaiePage({ searchParams }: { searchParams: Promise<{ mois?: string }> }) {
  const g = await garderPage("equipe.paie_export");
  if (!g.ok) return g.ecran;
  const params = await searchParams;
  const mois = moisValide(params.mois) ? params.mois : currentMonth();
  const d = await donneesMois(g.supabase, mois);
  const avertissements = d.controles.filter((c) => c.niveau === "avertissement");
  const infos = d.controles.filter((c) => c.niveau === "info");

  return (
    <div>
      <PageHeader
        title="Export pour le comptable"
        description="Préparez et contrôlez la paie dans GODAC, puis transmettez le mois à votre expert-comptable : c'est lui qui établit et dépose la DSN."
      />
      <NavigationMois base="/equipe/paie/export" mois={mois} libelle={d.libelle} />

      <Card className="mb-4 flex flex-col gap-3">
        <p className="text-sm font-semibold">Contrôles avant export</p>
        {avertissements.length === 0 ? (
          <p className="text-sm text-teal-ink">
            Aucun écart : {d.bulletins.length} bulletin{d.bulletins.length > 1 ? "s" : ""} validé{d.bulletins.length > 1 ? "s" : ""} pour {d.salaries.length} salarié
            {d.salaries.length > 1 ? "s" : ""}.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {avertissements.map((c) => (
              <li key={c.message} className="rounded-xl border border-gold/40 bg-gold/10 px-3 py-2 text-sm">
                <strong>
                  {c.message} ({c.salaries.length})
                </strong>
                <span className="block text-navy/70">{c.salaries.join(", ")}</span>
              </li>
            ))}
          </ul>
        )}
        {infos.map((c) => (
          <p key={c.message} className="text-sm text-navy/70">
            {c.message} : {c.salaries.join(", ")}.
          </p>
        ))}
        {avertissements.length > 0 && <p className="text-xs text-navy/60">Ces points n&apos;empêchent pas l&apos;export : le statut de chaque bulletin figure dans le fichier.</p>}
      </Card>

      <Card className="flex flex-col gap-4">
        <form action="/api/paie/export" method="get" className="flex flex-col gap-3">
          <input type="hidden" name="mois" value={mois} />
          <fieldset className="flex flex-col gap-2">
            <legend className="label">Contenu</legend>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="format" value="complet" defaultChecked className="mt-1" />
              <span>
                <strong>Paie complète</strong> — une ligne par salarié : heures, absences, CP, paniers, primes, brut, cotisations salariales et patronales par
                rubrique, réduction générale, nets, prélèvement à la source, acomptes, saisies, net payé, date de paiement et statut du bulletin.
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="format" value="variables" className="mt-1" />
              <span>
                <strong>Éléments variables</strong> — seulement les entrées du mois (heures, paniers, primes, absences, CP, acomptes, saisies), pour un
                comptable qui refait la paie dans son logiciel. Sans bulletin, les valeurs préremplies par GODAC sont reprises, à vérifier.
              </span>
            </label>
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="pdf" value="1" />
            Joindre le journal de paie en PDF (archive ZIP)
          </label>
          <p className="text-xs text-navy/60">Fichier CSV : séparateur point-virgule, décimales à la virgule, UTF-8 — s&apos;ouvre directement dans Excel.</p>
          <button type="submit" className="btn-primary self-start !py-2 text-sm">
            Télécharger l&apos;export de {d.libelle}
          </button>
        </form>
        <p className="text-sm text-navy/70">
          Voir aussi le <Link href={`/equipe/paie/journal?mois=${mois}`} className="font-semibold underline">journal de paie</Link> du mois à l&apos;écran.
        </p>
      </Card>
    </div>
  );
}
