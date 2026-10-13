import Link from "next/link";
import { Wordmark } from "@/components/brand/Wordmark";
import { BoutonImprimer, ThemeClairPourImpression } from "@/components/marketing/BoutonImprimer";
import { calculerDevis, euros, OFFRE_FONDATEUR, TVA } from "@/lib/commercial/devis";
import { EDITEUR, VERSION_CONTRATS, designationEditeur } from "@/lib/legal/editeur";
import type { ModuleCatalogEntry, ModulePlanPrice, Plan } from "@/lib/organization/catalog-types";

const cel = "border border-navy/15 px-2 py-1.5";

function ChampVide({ label }: { label: string }) {
  return (
    <div className="flex items-end gap-2 text-sm">
      <span className="shrink-0 text-navy/65">{label}</span>
      <span className="mb-1 flex-1 border-b border-dotted border-navy/40" />
    </div>
  );
}

/** Bon de commande imprimable (prix du catalogue, offre Fondateur optionnelle). */
export function BonDeCommande({
  plans,
  modules,
  prices,
  planId,
  choisis,
  fondateur: fondateurDemande,
}: {
  plans: Plan[];
  modules: ModuleCatalogEntry[];
  prices: ModulePlanPrice[];
  planId: string | undefined;
  choisis: string[];
  fondateur: boolean;
}) {
  const plan = plans.find((x) => x.id === planId) ?? plans.find((x) => x.is_public) ?? plans[0]!;
  const d = calculerDevis(plan, modules, prices, choisis, fondateurDemande);
  const aujourdhui = new Date();
  const numero = `BC-${aujourdhui.toISOString().slice(0, 10).replace(/-/g, "")}-${plan.id.toUpperCase().slice(0, 3)}`;
  const date = aujourdhui.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });
  const validite = new Date(aujourdhui.getTime() + 30 * 86_400_000).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 bg-white px-6 py-8 text-navy print:max-w-none print:px-0 print:py-0 print:text-[11px]">
      <ThemeClairPourImpression />
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/modules" className="text-sm text-teal-ink hover:underline">
          ← Modifier la sélection
        </Link>
        <BoutonImprimer />
      </div>

      <header className="flex items-start justify-between gap-4">
        <Wordmark height={30} />
        <div className="text-right">
          <h1 className="text-xl">Bon de commande</h1>
          <p className="text-xs text-navy/60">
            N° {numero} · {date}
            <br />
            Offre valable jusqu’au {validite}
          </p>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 print:grid-cols-2">
        <div className="rounded-lg border border-navy/15 p-3 text-sm">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-navy/55">Éditeur</p>
          <p>{designationEditeur()}</p>
          <p className="mt-1">
            {EDITEUR.email} · {EDITEUR.site.replace("https://", "")}
          </p>
        </div>
        <div className="flex flex-col gap-2 rounded-lg border border-navy/15 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-navy/55">Client</p>
          <ChampVide label="Raison sociale" />
          <ChampVide label="SIRET" />
          <ChampVide label="Adresse" />
          <ChampVide label="Signataire et fonction" />
          <ChampVide label="E-mail / téléphone" />
          <ChampVide label="Nombre de véhicules" />
        </div>
      </section>

      <section>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-navy/[0.05] text-left">
              <th className={cel}>Désignation</th>
              <th className={`${cel} text-right`}>Mensuel HT</th>
              <th className={`${cel} text-right`}>Mise en service HT</th>
            </tr>
          </thead>
          <tbody>
            {d.lignes.map((l) => (
              <tr key={l.libelle} className={l.inclus ? "text-navy/60" : ""}>
                <td className={cel}>
                  {l.libelle}
                  {l.detail && <span className="block text-xs text-navy/55">{l.detail}</span>}
                </td>
                <td className={`${cel} text-right tabular-nums`}>{l.inclus ? "inclus" : euros(l.mensuel)}</td>
                <td className={`${cel} text-right tabular-nums`}>{l.inclus ? "—" : euros(l.miseEnService)}</td>
              </tr>
            ))}
            {d.remiseFondateur > 0 && (
              <tr>
                <td className={cel}>{OFFRE_FONDATEUR}</td>
                <td className={`${cel} text-right`}>—</td>
                <td className={`${cel} text-right tabular-nums`}>− {euros(d.remiseFondateur)}</td>
              </tr>
            )}
          </tbody>
          <tfoot className="font-semibold">
            <tr>
              <td className={cel}>Total HT</td>
              <td className={`${cel} text-right tabular-nums`}><span className="whitespace-nowrap">{euros(d.mensuelHT)} / mois</span></td>
              <td className={`${cel} text-right tabular-nums`}>{euros(d.miseEnServiceNetHT)}</td>
            </tr>
            <tr className="font-normal text-navy/70">
              <td className={cel}>TVA {TVA * 100} %</td>
              <td className={`${cel} text-right tabular-nums`}>{euros(d.mensuelHT * TVA)}</td>
              <td className={`${cel} text-right tabular-nums`}>{euros(d.miseEnServiceNetHT * TVA)}</td>
            </tr>
            <tr>
              <td className={cel}>Total TTC</td>
              <td className={`${cel} text-right tabular-nums`}><span className="whitespace-nowrap">{euros(d.mensuelHT * (1 + TVA))} / mois</span></td>
              <td className={`${cel} text-right tabular-nums`}>{euros(d.miseEnServiceNetHT * (1 + TVA))}</td>
            </tr>
          </tfoot>
        </table>
        {d.echeances > 1 && (
          <p className="mt-2 text-xs text-navy/70">
            Mise en service de la formule {plan.name} payable en {d.echeances} mensualités de{" "}
            {euros(Math.round((Number(plan.setup_price) / d.echeances) * 100) / 100)} HT, ajoutées aux {d.echeances} premières factures, sans frais.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-1 text-xs leading-relaxed text-navy/75">
        <p className="text-sm font-semibold text-navy">Conditions</p>
        <p>
          Abonnement d’une durée initiale de 12 mois à compter de l’ouverture de l’accès, puis renouvelable de mois en mois,
          résiliable avec un préavis d’un mois. Facturation mensuelle terme à échoir, payable à réception par prélèvement SEPA
          ou carte bancaire. Mise en service facturée à la commande, ou échelonnée lorsque c’est indiqué ci-dessus. Application GODAC Livreur gratuite pour le chauffeur, facturée à l’entreprise par palier d’utilisateurs.
          Données hébergées en France.
        </p>
        <p>
          Documents contractuels (version {VERSION_CONTRATS}), acceptés par la signature du présent bon : conditions générales
          de vente ({EDITEUR.site.replace("https://", "")}/cgv), accord de sous-traitance des données ({EDITEUR.site.replace("https://", "")}/dpa),
          engagement de niveau de service ({EDITEUR.site.replace("https://", "")}/sla), conditions d’utilisation ({EDITEUR.site.replace("https://", "")}/cgu).
        </p>
        <p>Conditions particulières :</p>
        <div className="h-10 border-b border-dotted border-navy/40" />
      </section>

      <section className="grid grid-cols-2 gap-4">
        {["Pour le Client", "Pour l’Éditeur"].map((t) => (
          <div key={t} className="flex h-36 flex-col rounded-lg border border-navy/15 p-3 text-xs">
            <p className="font-semibold">{t}</p>
            <p className="text-navy/60">Date, nom, signature{t === "Pour le Client" ? ", cachet et mention « Bon pour accord »" : ""}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
