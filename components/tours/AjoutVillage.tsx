"use client";

import { useState } from "react";
import { ChampSuggestions } from "@/components/tours/ChampSuggestions";
import { analyserSaisie, codePostalValide, libelleSuggestion, saisieRecherchable, type SuggestionCommune } from "@/lib/tours/ajout-village";

/** Recherche de communes (geo.api.gouv.fr via notre route) ; null si le service est injoignable. */
export async function chercherCommunes(texte: string, signal?: AbortSignal): Promise<{ results: SuggestionCommune[]; indisponible: boolean }> {
  const res = await fetch(`/api/tour-routes/communes?q=${encodeURIComponent(texte.trim())}`, { signal });
  if (!res.ok) return { results: [], indisponible: true };
  const json = (await res.json()) as { results?: SuggestionCommune[]; indisponible?: boolean };
  return { results: json.results ?? [], indisponible: Boolean(json.indisponible) };
}

/**
 * « Ajouter un village : nom ou code postal ». Choisir une suggestion ajoute
 * le village avec son nom officiel, son code postal et ses coordonnées.
 * Repli discret « Saisir à la main » (nom ET code postal valides exigés).
 */
export function AjoutVillage({
  onAjouter,
  onManuel,
}: {
  /** Renvoie un message (ex. « déjà dans la fiche ») ou null si le village est ajouté. */
  onAjouter: (s: SuggestionCommune) => Promise<string | null>;
  onManuel: (nom: string, codePostal: string) => Promise<string | null>;
}) {
  const [manuel, setManuel] = useState(false);
  const [nom, setNom] = useState("");
  const [cp, setCp] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const valide = nom.trim().length > 0 && codePostalValide(cp);

  async function ajouterManuel() {
    if (!valide) return;
    const m = await onManuel(nom.trim(), cp.trim());
    setMsg(m);
    if (!m) {
      setNom("");
      setCp("");
      setManuel(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <ChampSuggestions<SuggestionCommune>
        libelle="Ajouter un village"
        placeholder="Nom ou code postal : Ponteilla, 66300…"
        peutChercher={(t) => saisieRecherchable(analyserSaisie(t))}
        chercher={async (t, signal) => {
          const r = await chercherCommunes(t, signal);
          return { items: r.results, indisponible: r.indisponible };
        }}
        cle={(s) => `${s.insee_code ?? s.name}-${s.postal_code}`}
        rendu={(s) => (
          <span className="min-w-0 flex-1">
            <span className="font-semibold">{s.name}</span>
            <span className="ml-1.5 tabular-nums text-navy/70">{s.postal_code}</span>
            {s.departement && <span className="ml-1.5 text-xs text-navy/55">{s.departement}</span>}
            <span className="sr-only">{libelleSuggestion(s)}</span>
          </span>
        )}
        onChoisir={onAjouter}
        aide="Tapez le nom de la commune, son code postal, ou les deux."
        vide="Aucune commune trouvée. Vérifiez l'orthographe ou saisissez à la main."
        indisponible="Recherche indisponible (réseau ou service). Saisissez le village à la main."
        pied={({ indisponible }) =>
          manuel ? null : (
            <button type="button" className={indisponible ? "btn-secondary w-fit !py-2 text-sm" : "w-fit min-h-[44px] rounded-lg px-1 text-xs font-semibold text-navy/60 underline-offset-2 hover:text-navy hover:underline sm:min-h-0"} onClick={() => setManuel(true)}>
              Saisir à la main
            </button>
          )
        }
      />
      {manuel && (
        <form className="flex flex-wrap items-end gap-2 rounded-xl border border-navy/10 bg-paper p-2.5" onSubmit={(e) => { e.preventDefault(); void ajouterManuel(); }}>
          <label className="min-w-[10rem] flex-1">
            <span className="label">Commune</span>
            <input className="input" value={nom} onChange={(e) => setNom(e.target.value)} autoFocus autoComplete="off" />
          </label>
          <label className="w-28">
            <span className="label">Code postal</span>
            <input className="input tabular-nums" inputMode="numeric" maxLength={5} value={cp} onChange={(e) => setCp(e.target.value.replace(/\D/g, ""))} autoComplete="off" />
          </label>
          <button type="submit" className="btn-primary" disabled={!valide}>Ajouter</button>
          <button type="button" className="btn-ghost" onClick={() => { setManuel(false); setMsg(null); }}>Annuler</button>
        </form>
      )}
      {msg && <p role="alert" className="text-xs text-orange-ink">{msg}</p>}
    </div>
  );
}
