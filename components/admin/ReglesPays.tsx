import type { Pays } from "@/lib/pays/pays";

/** Ce que le choix du pays change dans GODAC, affiché sous le sélecteur. */
export function ReglesPays({ pays }: { pays: Pays }) {
  const lignes: [string, React.ReactNode][] = [
    [
      "Protection des données",
      <>
        {pays.donnees.loi} — autorité :{" "}
        <a href={pays.donnees.site} target="_blank" rel="noreferrer" className="text-teal-ink hover:underline">
          {pays.donnees.autorite}
        </a>
        {pays.donnees.transfert && <span className="mt-1 block text-orange-ink">{pays.donnees.transfert}</span>}
      </>,
    ],
    ["Temps de conduite", pays.tempsConduite],
    [
      "Paie",
      pays.paie.moteur ? (
        <>Bulletins calculés par GODAC ({pays.paie.organismes}).</>
      ) : (
        <>
          Pas de calcul de bulletin pour ce pays : GODAC fournit les heures, absences et frais à transmettre à votre gestionnaire de paie
          ({pays.paie.organismes}).
        </>
      ),
    ],
    ["Monnaie", pays.devise === "EUR" ? "EUR" : `${pays.devise} — les montants restent affichés en euros dans GODAC pour l'instant.`],
  ];
  if (pays.code !== "FR") lignes.push(["Non proposé", "Export TICPE (dispositif fiscal français)."]);
  return (
    <dl className="grid gap-2 rounded-lg bg-navy/[0.04] p-3 text-sm">
      {lignes.map(([t, v]) => (
        <div key={t}>
          <dt className="text-xs font-semibold uppercase tracking-wide text-navy/55">{t}</dt>
          <dd className="text-navy/80">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
