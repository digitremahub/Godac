import { garderPage } from "@/lib/acces/garde-page";
import { PageHeader, Card } from "@/components/ui";
import { AvertissementTicpe } from "@/components/ticpe/AvertissementTicpe";
import { ReglagesTicpeForm } from "@/components/ticpe/ReglagesTicpeForm";
import { SurchargesTicpe, TableBaremeTicpe, type SurchargeAffichee } from "@/components/ticpe/BaremeTicpe";
import { chargerParametresTicpe } from "@/lib/ticpe/serveur";
import { ZonesCuves } from "@/components/ticpe/ZonesCuves";

/**
 * Réglages TICPE de l'organisation (direction, comptable) : activités,
 * régime de TVA, plafond, produits, location ; barème GODAC en lecture ;
 * taux particuliers de l'organisation (tracés).
 */
export default async function ReglagesTicpePage() {
  const g = await garderPage("carburant.ticpe_reglages");
  if (!g.ok) return g.ecran;
  const { appUser, supabase } = g;
  const p = await chargerParametresTicpe(supabase, appUser.organization_id);

  const cuvesRes = await supabase.from("tanks").select("id, name, ticpe_zone").order("name");
  const cuves = cuvesRes.error ? null : ((cuvesRes.data ?? []) as { id: string; name: string; ticpe_zone: "metropole" | "corse" | null }[]);
  const auteurs = new Set(p.surcharges.map((s) => s.created_by).filter((x): x is string => Boolean(x)));
  const { data: personnes } = auteurs.size ? await supabase.from("users").select("id, full_name").in("id", [...auteurs]) : { data: [] as { id: string; full_name: string }[] };
  const surcharges: SurchargeAffichee[] = p.surcharges.map((s) => ({
    id: s.id,
    categorie: s.categorie,
    zone: s.zone,
    date_debut: s.date_debut,
    date_fin: s.date_fin,
    taux_eur_hl: s.taux_eur_hl,
    motif: s.motif,
    created_at: s.created_at,
    revoked_at: s.revoked_at ?? null,
    auteur: (personnes ?? []).find((x) => x.id === s.created_by)?.full_name ?? null,
  }));

  return (
    <div>
      <PageHeader title="Réglages TICPE" description="Le modèle standard convient à la plupart des transporteurs routiers de marchandises ; adaptez-le à votre entreprise." />
      <AvertissementTicpe migrationManquante={p.migrationManquante} />
      {!p.reglagesEnregistres && !p.migrationManquante && (
        <p className="mb-4 text-sm text-navy/70">Réglages jamais enregistrés : les valeurs du modèle standard s&apos;appliquent.</p>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <ReglagesTicpeForm initial={p.reglages} lectureSeule={p.migrationManquante} />
        </Card>
        <div className="flex flex-col gap-6">
          <Card>
            <h3 className="mb-1 text-base">Taux particuliers de votre entreprise</h3>
            <p className="mb-3 text-xs text-navy/60">
              Uniquement pour un cas particulier validé par votre expert-comptable : ils remplacent le barème GODAC sur leur période. Chaque ajout est tracé.
            </p>
            <SurchargesTicpe surcharges={surcharges} modifiable={!p.migrationManquante} />
          </Card>
          {cuves && cuves.length > 0 && (
            <Card>
              <h3 className="mb-1 text-base">Zone des cuves</h3>
              <p className="mb-3 text-xs text-navy/60">Les pleins faits à une cuve en Corse prennent le taux Corse. Modifiable par la direction.</p>
              <ZonesCuves cuves={cuves} modifiable={appUser.role === "direction"} />
            </Card>
          )}
          <Card>
            <h3 className="mb-1 text-base">Barème GODAC</h3>
            <p className="mb-3 text-xs text-navy/60">
              Tenu à jour par l&apos;équipe GODAC à partir des sources officielles. Un taux « à compléter » n&apos;est jamais inventé : les pleins concernés
              sont signalés « taux manquant ».
            </p>
            <TableBaremeTicpe bareme={p.bareme} />
          </Card>
        </div>
      </div>
    </div>
  );
}
