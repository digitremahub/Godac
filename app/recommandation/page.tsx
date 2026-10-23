import Link from "next/link";
import { Wordmark } from "@/components/brand/Wordmark";
import { BoutonImprimer, ThemeClairPourImpression } from "@/components/marketing/BoutonImprimer";
import { EDITEUR } from "@/lib/legal/editeur";

export const metadata = {
  title: "Vos chauffeurs utilisent déjà GO — GODAC",
  description: "Une page pour présenter GODAC à un employeur : suivi des tournées en direct, heures, archives et modules carburant, flotte, planning et paie.",
};

const POINTS = [
  ["Suivi des tournées en direct", "Vous voyez l'avancement des tournées de vos chauffeurs pendant la journée : arrêts faits, arrêts restants, position partagée par le chauffeur."],
  ["Heures", "Les heures de vos chauffeurs sont reprises de leur planning, de leur badge ou du retour de tournée, sans ressaisie."],
  ["Archives", "L'historique des tournées et des livraisons reste consultable, avec les preuves de livraison."],
  ["Modules carburant, flotte, planning et paie", "Les pleins, les véhicules et leurs entretiens, le planning et la préparation de la paie sont disponibles dans le même outil, à activer selon vos besoins."],
];

/**
 * Document d'une page à remettre à un employeur dont un chauffeur utilise
 * GO. Public, imprimable (feuille de style print), sans secret ni donnée
 * personnelle. Ne présente que ce que le produit fait aujourd'hui.
 */
export default function RecommandationPage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 bg-white px-6 py-8 text-navy print:max-w-none print:gap-4 print:px-0 print:py-0 print:text-[12px]">
      <ThemeClairPourImpression />
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/" className="text-sm text-teal-ink hover:underline">
          ← Site GODAC
        </Link>
        <BoutonImprimer />
      </div>

      <header className="flex flex-col gap-3 border-b border-navy/15 pb-5">
        <Wordmark height={32} />
        <h1 className="text-[28px] leading-tight sm:text-4xl print:text-3xl">Vos chauffeurs utilisent déjà GO</h1>
        <p className="text-base text-navy/75">
          GO est l&apos;application de navigation et de tournée de GODAC. Un ou plusieurs de vos chauffeurs l&apos;utilisent et ont souhaité vous la présenter. GODAC
          est la solution complète qui va avec, côté entreprise.
        </p>
      </header>

      <section aria-label="Ce que GODAC apporte à l'entreprise">
        <ul className="flex flex-col gap-4">
          {POINTS.map(([titre, texte]) => (
            <li key={titre} className="break-inside-avoid">
              <h2 className="font-display text-lg font-bold">{titre}</h2>
              <p className="mt-1 text-sm text-navy/75">{texte}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="break-inside-avoid rounded-xl border border-navy/15 p-4">
        <h2 className="font-display text-lg font-bold">Essai de 30 jours de l&apos;offre complète</h2>
        <p className="mt-1 text-sm text-navy/75">
          Testez GODAC avec vos chauffeurs pendant 30 jours. Demandez une démonstration : nous vous rappelons sous un jour ouvré.
        </p>
        <p className="mt-3 text-sm">
          <Link href="/contact" className="font-semibold text-teal-ink underline-offset-2 hover:underline">
            Demander une démo
          </Link>{" "}
          · {EDITEUR.site.replace("https://", "")}/contact · {EDITEUR.email}
        </p>
      </section>

      <p className="text-xs text-navy/60">Page d&apos;information : elle ne contient aucune donnée sur vos chauffeurs ni sur votre entreprise.</p>
    </main>
  );
}
