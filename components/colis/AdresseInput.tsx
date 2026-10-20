"use client";

import { useRef, useState } from "react";
import { IconBuilding, IconMapPin } from "@/components/layout/icons";
import type { SuggestionAdresse } from "@/lib/colis/recherche-adresses";

/** Suggestions d'adresses et d'entreprises : BAN en France + lieux professionnels OpenStreetMap. */
/**
 * Champ adresse : adresses postales ET établissements par leur nom
 * (« Pharmacie du Centre Saint-X », « Carrefour Market Y »). Résultats de
 * /api/colis/adresses/recherche (annuaire de l'entreprise, OpenStreetMap,
 * Base Adresse Nationale, Google Places si configuré), biaisés autour du
 * dépôt. Choisir un établissement remplit l'adresse, le nom et les
 * coordonnées (`onChoisir`) ; les horaires sont cherchés après l'ajout.
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
  const request = useRef(0);
  const listeId = useRef(`adresses-${Math.random().toString(36).slice(2)}`).current;

  function change(v: string) {
    onChange(v);
    clearTimeout(timer.current);
    const query = v.trim();
    const id = ++request.current;
    setActif(-1);
    if (query.length < 3) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const p = new URLSearchParams({ q: query });
        if (biais) {
          p.set("lat", String(biais.lat));
          p.set("lng", String(biais.lng));
        }
        const res = await fetch(`/api/colis/adresses/recherche?${p.toString()}`);
        const data = res.ok ? ((await res.json()) as { resultats?: SuggestionAdresse[] }) : { resultats: [] };
        if (request.current === id) setSuggestions(data.resultats ?? []);
      } catch {
        if (request.current === id) setSuggestions([]);
      } finally {
        if (request.current === id) setLoading(false);
      }
    }, 300);
  }

  function choisir(sug: SuggestionAdresse) {
    onChange(sug.adresse);
    onChoisir?.(sug);
    setSuggestions([]);
    setActif(-1);
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
          else if (e.key === "Enter" && actif >= 0) (e.preventDefault(), choisir(suggestions[actif]!));
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
      {loading && <p className="absolute right-3 top-3 text-xs text-navy/45">Recherche…</p>}
      {suggestions.length > 0 && (
        <ul id={listeId} role="listbox" className="absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-auto rounded-xl border border-navy/10 bg-surface shadow-pop">
          {suggestions.map((sug, i) => (
            <li key={`${sug.source}-${sug.nom ?? ""}-${sug.adresse}`} id={`${listeId}-${i}`} role="option" aria-selected={i === actif}>
              <button type="button" className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-navy/[0.05] ${i === actif ? "bg-navy/[0.05]" : ""}`} onClick={() => choisir(sug)}>
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
