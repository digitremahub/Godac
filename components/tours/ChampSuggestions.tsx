"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export interface ReponseRecherche<T> {
  items: T[];
  /** Le service n'a pas répondu : message clair et saisie à la main. */
  indisponible?: boolean;
}

/** Délai avant de lancer la recherche : réponse quasi instantanée sans mitrailler le serveur. */
const DEBOUNCE_MS = 150;

/**
 * Champ de recherche avec suggestions instantanées (combobox / listbox
 * accessible) : ↑ ↓ pour parcourir, Entrée pour choisir, Échap pour fermer.
 * Après un choix le champ est vidé et garde le focus pour enchaîner.
 * `onChoisir` renvoie un message (ex. « déjà dans la fiche ») ou null.
 */
export function ChampSuggestions<T>({
  libelle,
  placeholder,
  aide,
  peutChercher,
  chercher,
  cleCache = "",
  cle,
  rendu,
  onChoisir,
  vide = "Aucun résultat.",
  indisponible = "Recherche indisponible pour le moment.",
  autoFocus,
  pied,
}: {
  libelle: string;
  placeholder: string;
  aide?: string;
  peutChercher: (texte: string) => boolean;
  /** `maj` affiche des résultats partiels avant la fin (sources lentes). */
  chercher: (texte: string, signal: AbortSignal, maj: (items: T[]) => void) => Promise<ReponseRecherche<T>>;
  /** Partitionne le cache (ex. position du village). */
  cleCache?: string;
  cle: (item: T) => string;
  rendu: (item: T) => ReactNode;
  onChoisir: (item: T) => Promise<string | null> | string | null;
  vide?: string;
  indisponible?: string;
  autoFocus?: boolean;
  /** Repli affiché sous le champ (saisie à la main). */
  pied?: (etat: { indisponible: boolean; aucunResultat: boolean }) => ReactNode;
}) {
  const id = useId();
  const [texte, setTexte] = useState("");
  const [items, setItems] = useState<T[]>([]);
  const [actif, setActif] = useState(0);
  const [ouvert, setOuvert] = useState(false);
  const [charge, setCharge] = useState(false);
  const [hs, setHs] = useState(false);
  const [termine, setTermine] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const abort = useRef<AbortController | null>(null);
  const cache = useRef(new Map<string, T[]>());

  useEffect(() => () => {
    clearTimeout(timer.current);
    abort.current?.abort();
  }, []);

  function saisir(valeur: string) {
    setTexte(valeur);
    setMessage(null);
    clearTimeout(timer.current);
    abort.current?.abort();
    setActif(0);
    setTermine(false);
    if (!peutChercher(valeur)) {
      setItems([]);
      setOuvert(false);
      setCharge(false);
      setHs(false);
      return;
    }
    setOuvert(true);
    const clef = `${cleCache}|${valeur.trim().toLowerCase().replace(/\s+/g, " ")}`;
    const connu = cache.current.get(clef);
    if (connu) {
      setItems(connu);
      setCharge(false);
      setHs(false);
      setTermine(true);
      return;
    }
    const ctrl = new AbortController();
    abort.current = ctrl;
    setCharge(true);
    timer.current = setTimeout(async () => {
      try {
        const r = await chercher(valeur, ctrl.signal, (partiel) => {
          if (!ctrl.signal.aborted) setItems(partiel);
        });
        if (ctrl.signal.aborted) return;
        setItems(r.items);
        setHs(Boolean(r.indisponible));
        setTermine(true);
        if (!r.indisponible) cache.current.set(clef, r.items);
      } catch {
        if (ctrl.signal.aborted) return;
        setItems([]);
        setHs(true);
        setTermine(true);
      } finally {
        if (abort.current === ctrl) setCharge(false);
      }
    }, DEBOUNCE_MS);
  }

  async function choisir(item: T) {
    clearTimeout(timer.current);
    abort.current?.abort();
    setTexte("");
    setItems([]);
    setOuvert(false);
    setCharge(false);
    setTermine(false);
    setHs(false);
    setMessage(await onChoisir(item));
    input.current?.focus();
  }

  function touche(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      if (ouvert) {
        e.preventDefault();
        e.stopPropagation();
        setOuvert(false);
      }
      return;
    }
    if (!ouvert || items.length === 0) return;
    if (e.key === "ArrowDown") (e.preventDefault(), setActif((i) => (i + 1) % items.length));
    else if (e.key === "ArrowUp") (e.preventDefault(), setActif((i) => (i - 1 + items.length) % items.length));
    else if (e.key === "Enter") (e.preventDefault(), void choisir(items[Math.min(actif, items.length - 1)]!));
  }

  const aucun = termine && !hs && items.length === 0;
  const liste = ouvert && items.length > 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <label htmlFor={`${id}-champ`} className="label">{libelle}</label>
        <input
          ref={input}
          id={`${id}-champ`}
          className="input"
          value={texte}
          onChange={(e) => saisir(e.target.value)}
          onKeyDown={touche}
          onFocus={() => items.length > 0 && setOuvert(true)}
          onBlur={() => setTimeout(() => setOuvert(false), 120)}
          placeholder={placeholder}
          autoComplete="off"
          autoFocus={autoFocus}
          role="combobox"
          aria-expanded={liste}
          aria-controls={`${id}-liste`}
          aria-autocomplete="list"
          aria-activedescendant={liste ? `${id}-${actif}` : undefined}
        />
        {liste && (
          <ul id={`${id}-liste`} role="listbox" aria-label={libelle} className="absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-auto rounded-xl border border-navy/10 bg-surface p-1 shadow-pop">
            {items.map((item, i) => (
              <li key={cle(item)} id={`${id}-${i}`} role="option" aria-selected={i === actif}>
                <button
                  type="button"
                  tabIndex={-1}
                  className={`flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-navy/[0.05] ${i === actif ? "bg-teal/10" : ""}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActif(i)}
                  onClick={() => void choisir(item)}
                >
                  {rendu(item)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="min-h-[1rem] text-xs text-navy/60" role="status" aria-live="polite">
        {message ?? (hs ? indisponible : aucun ? vide : charge && items.length === 0 ? "Recherche…" : aide ?? "")}
      </p>
      {pied?.({ indisponible: hs, aucunResultat: aucun })}
    </div>
  );
}
