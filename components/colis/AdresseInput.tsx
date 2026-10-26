"use client";

import { useEffect, useRef, useState } from "react";
import { IconBuilding, IconMapPin } from "@/components/layout/icons";
import { CacheSuggestions, cleBiais } from "@/lib/colis/cache-adresses";
import { completerSuggestions, type SuggestionAdresse } from "@/lib/colis/recherche-adresses";
import { suggestionValidee } from "@/lib/colis/recherche-arret";

/** Debounce court : la réponse serveur est rapide (Google ou BAN), on ne retarde pas la frappe. */
const DEBOUNCE_MS = 150;
/** Cache partagé par tous les champs adresse de la page (préfixes déjà cherchés). */
const cache = new CacheSuggestions();

const nouveauJeton = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `s${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`.padEnd(16, "0"));

/**
 * Champ adresse : adresses postales ET établissements par leur nom
 * (« Pharmacie du Centre Saint-X », « Carrefour Market Y »). Réponse en deux
 * temps depuis /api/colis/adresses/recherche : Google Places (ou BAN sans clé)
 * s'affiche dès la première réponse, OpenStreetMap complète ensuite. Les
 * requêtes obsolètes sont annulées, les préfixes déjà vus viennent du cache.
 * Choisir une suggestion Google résout ses coordonnées (Place Details, même
 * jeton de session) avant `onChoisir` ; les horaires sont cherchés après l'ajout.
 */
export function AdresseInput({
  value,
  onChange,
  onChoisir,
  autoFocus,
  biais,
}: {
  value: string;
  onChange: (v: string) => void;
  onChoisir?: (s: SuggestionAdresse) => void;
  autoFocus?: boolean;
  /** Dépôt de la tournée (ou position du chauffeur) pour privilégier les résultats proches. */
  biais?: { lat: number; lng: number } | null;
}) {
  const [suggestions, setSuggestions] = useState<SuggestionAdresse[]>([]);
  const [loading, setLoading] = useState(false);
  const [actif, setActif] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const abort = useRef<AbortController | null>(null);
  const jeton = useRef<string | null>(null);
  const listeId = useRef(`adresses-${Math.random().toString(36).slice(2)}`).current;

  useEffect(() => () => {
    clearTimeout(timer.current);
    abort.current?.abort();
  }, []);

  async function chercher(query: string, ctrl: AbortController) {
    const cleCache = cleBiais(biais);
    const p = new URLSearchParams({ q: query });
    if (biais) {
      p.set("lat", String(biais.lat));
      p.set("lng", String(biais.lng));
    }
    jeton.current ??= nouveauJeton();
    p.set("session", jeton.current);
    const lire = async (phase: "rapide" | "complement") => {
      p.set("phase", phase);
      const res = await fetch(`/api/colis/adresses/recherche?${p.toString()}`, { signal: ctrl.signal });
      return res.ok ? ((await res.json()) as { resultats?: SuggestionAdresse[]; complement?: boolean }) : { resultats: [], complement: false };
    };
    try {
      const premiere = await lire("rapide");
      if (ctrl.signal.aborted) return;
      let liste = premiere.resultats ?? [];
      setSuggestions(liste);
      setLoading(false);
      if (!premiere.complement) {
        cache.ecrire(query, cleCache, liste);
        return;
      }
      // Sources lentes (OpenStreetMap) : ajoutées à la suite, sans rien déplacer.
      const suite = await lire("complement");
      if (ctrl.signal.aborted) return;
      liste = completerSuggestions(liste, suite.resultats ?? []);
      cache.ecrire(query, cleCache, liste);
      setSuggestions(liste);
    } catch {
      /* annulée ou réseau : on garde ce qui est affiché */
    } finally {
      if (abort.current === ctrl) setLoading(false);
    }
  }

  function change(v: string) {
    onChange(v);
    clearTimeout(timer.current);
    abort.current?.abort();
    const query = v.trim();
    setActif(-1);
    if (query.length < 3) {
      setSuggestions([]);
      setLoading(false);
      jeton.current = null;
      return;
    }
    const cleCache = cleBiais(biais);
    const connu = cache.lire(query, cleCache);
    if (connu) {
      setSuggestions(connu);
      setLoading(false);
      return;
    }
    // Pendant la frappe : résultats du préfixe précédent filtrés, en attendant le serveur.
    setSuggestions(cache.depuisPrefixe(query, cleCache));
    const ctrl = new AbortController();
    abort.current = ctrl;
    setLoading(true);
    timer.current = setTimeout(() => void chercher(query, ctrl), DEBOUNCE_MS);
  }

  async function choisir(sug: SuggestionAdresse) {
    clearTimeout(timer.current);
    abort.current?.abort();
    const session = jeton.current;
    jeton.current = null; // un jeton par saisie : la suivante repart d'un nouveau
    onChange(sug.adresse);
    setSuggestions([]);
    setLoading(false);
    setActif(-1);
    if (sug.lat === null && sug.placeId) {
      // Suggestion Google : coordonnées demandées seulement maintenant (Place Details).
      try {
        const p = new URLSearchParams({ place_id: sug.placeId });
        if (session) p.set("session", session);
        const res = await fetch(`/api/colis/adresses/detail?${p.toString()}`, { signal: AbortSignal.timeout(3500) });
        const data = res.ok ? ((await res.json()) as { lieu?: { lat: number; lng: number } | null }) : null;
        if (data?.lieu) {
          onChoisir?.({ ...sug, lat: data.lieu.lat, lng: data.lieu.lng });
          return;
        }
      } catch {
        /* repli : l'appelant géocode l'adresse */
      }
    }
    onChoisir?.(sug);
  }

  return (
    <div className="relative">
      <input
        className="input"
        value={value}
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => {
          if (suggestions.length === 0) return;
          if (e.key === "ArrowDown") (e.preventDefault(), setActif((i) => Math.min(suggestions.length - 1, i + 1)));
          else if (e.key === "ArrowUp") (e.preventDefault(), setActif((i) => Math.max(0, i - 1)));
          // Entrée choisit la suggestion surlignée, à défaut la première : l'adresse s'affiche tout de suite.
          else if (e.key === "Enter") (e.preventDefault(), void choisir(suggestions[suggestionValidee(actif, suggestions.length)]!));
          else if (e.key === "Escape") setSuggestions([]);
        }}
        placeholder="Nom de l'entreprise, du commerce ou adresse…"
        autoFocus={autoFocus}
        aria-label="Entreprise, commerce ou adresse de livraison"
        autoComplete="off"
        role="combobox"
        aria-expanded={suggestions.length > 0}
        aria-controls={listeId}
        aria-activedescendant={actif >= 0 ? `${listeId}-${actif}` : undefined}
      />
      {loading && suggestions.length === 0 && <p className="absolute right-3 top-3 text-xs text-navy/45">Recherche…</p>}
      {suggestions.length > 0 && (
        <ul id={listeId} role="listbox" className="absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-auto rounded-xl border border-navy/10 bg-surface shadow-pop">
          {suggestions.map((sug, i) => (
            <li key={`${sug.source}-${sug.nom ?? ""}-${sug.adresse}`} id={`${listeId}-${i}`} role="option" aria-selected={i === actif}>
              <button type="button" className={`flex min-h-[44px] w-full items-start gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-navy/[0.05] ${i === actif ? "bg-navy/[0.05]" : ""}`} onClick={() => void choisir(sug)}>
                <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${sug.type === "etablissement" ? "bg-teal/15 text-teal-ink" : "bg-navy/[0.06] text-navy/55"}`} aria-hidden="true">
                  {sug.type === "etablissement" ? <IconBuilding className="h-3.5 w-3.5" /> : <IconMapPin className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0">
                  <span className="sr-only">{sug.type === "etablissement" ? "Établissement : " : "Adresse : "}</span>
                  {sug.nom && <span className="block font-semibold">{sug.nom}</span>}
                  <span className={`block ${sug.nom ? "text-xs text-navy/65" : "font-medium"}`}>{sug.adresse}</span>
                  {(sug.detail || sug.source === "annuaire") && <span className="mt-0.5 block text-[11px] text-navy/50">{sug.detail ?? "Déjà livré par votre équipe"}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
