import { formaterQuantite } from "@/lib/stock/soldes";
import type { LigneHistorique } from "@/lib/stock/historique";

/** Mouvements : fiches empilées sur téléphone, tableau à partir de md. Composant serveur, sans script. */
export function TableauMouvements({ lignes, legende }: { lignes: readonly LigneHistorique[]; legende: string }) {
  const trajet = (l: LigneHistorique) => (l.de || l.vers ? `${l.de || "—"} → ${l.vers || "—"}` : "");
  const quantite = (l: LigneHistorique) => `${formaterQuantite(l.quantite)}${l.unite && l.unite !== "unité" ? ` ${l.unite}` : ""}`;
  return (
    <>
      <ul className="flex flex-col gap-2 md:hidden" aria-label={legende}>
        {lignes.map((l) => (
          <li key={l.id} className="card !p-3.5">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 break-words font-semibold">
                {l.libelleType} · {l.objet}
              </p>
              <span className="shrink-0 text-sm font-semibold tabular-nums">{quantite(l)}</span>
            </div>
            <p className="mt-0.5 text-xs text-navy/65">
              {l.date} à {l.heure} · {l.auteur || "—"} · {l.origine}
              {l.depot ? ` · ${l.depot}` : ""}
            </p>
            {(trajet(l) || l.statut || l.lot || l.motif) && (
              <p className="mt-1 break-words text-xs text-navy/80">{[trajet(l), l.statut, l.lot ? `lot ${l.lot}` : "", l.motif].filter(Boolean).join(" · ")}</p>
            )}
          </li>
        ))}
      </ul>
      <div className="card hidden overflow-x-auto !p-0 md:block">
        <table className="w-full min-w-[760px] text-left text-sm">
          <caption className="sr-only">{legende}</caption>
          <thead className="text-xs uppercase tracking-wide text-navy/60">
            <tr>
              {["Date", "Mouvement", "Unité ou article", "Quantité", "Dépôt", "Emplacements", "Statut", "Motif", "Auteur", "Origine"].map((t) => (
                <th key={t} scope="col" className="px-3 py-2.5 font-semibold">
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.id} className="border-t border-navy/[0.06] align-top">
                <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">
                  {l.date} {l.heure}
                </td>
                <td className="px-3 py-2.5 font-semibold">{l.libelleType}</td>
                <td className="break-words px-3 py-2.5">{l.objet}</td>
                <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{quantite(l)}</td>
                <td className="px-3 py-2.5">{l.depot}</td>
                <td className="whitespace-nowrap px-3 py-2.5">{trajet(l)}</td>
                <td className="px-3 py-2.5">{l.statut}</td>
                <td className="break-words px-3 py-2.5">{[l.lot ? `lot ${l.lot}` : "", l.motif].filter(Boolean).join(" · ")}</td>
                <td className="px-3 py-2.5">{l.auteur}</td>
                <td className="px-3 py-2.5">{l.origine}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
