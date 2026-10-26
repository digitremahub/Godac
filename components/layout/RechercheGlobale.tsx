"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ResultatEntite, ResultatPage } from "@/lib/recherche/recherche";

interface Reponse {
  pages: ResultatPage[];
  entites: Partial<Record<"chauffeurs" | "vehicules" | "tournees", ResultatEntite[]>>;
}

interface Option {
  id: string;
  groupe: string;
  libelle: string;
  detail: string | null;
  href: string;
}

const TITRES = { pages: "Pages et fonctions", chauffeurs: "Chauffeurs", vehicules: "Véhicules", tournees: "Tournées" } as const;
const DELAI_MS = 250;

/**
 * Palette de recherche (Ctrl+K, ou la loupe de l'en-tête, mobile compris) :
 * pages autorisées pour le rôle, puis chauffeurs, véhicules et tournées du
 * périmètre dès 2 caractères. Combobox + listbox accessibles : flèches,
 * Entrée, Échap, focus gardé dans la fenêtre. Les résultats viennent de
 * /api/recherche (RLS) ; aucun résultat n'est calculé côté navigateur.
 */
export function RechercheGlobale() {
  const router = useRouter();
  const [ouvert, setOuvert] = useState(false);
  const [saisie, setSaisie] = useState("");
  const [reponse, setReponse] = useState<Reponse | null>(null);
  const [chargement, setChargement] = useState(false);
  const [actif, setActif] = useState(0);
  const [erreur, setErreur] = useState(false);
  const idBase = useId();
  const champ = useRef<HTMLInputElement>(null);
  const fenetre = useRef<HTMLDivElement>(null);
  const declencheur = useRef<HTMLButtonElement>(null);

  const fermer = useCallback(() => {
    setOuvert(false);
    setSaisie("");
    setReponse(null);
    declencheur.current?.focus();
  }, []);

  // Raccourci clavier global : Ctrl+K / Cmd+K.
  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOuvert((o) => !o);
      }
    };
    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, []);

  useEffect(() => {
    if (ouvert) champ.current?.focus();
  }, [ouvert]);

  // Requête après une courte pause de frappe ; une réponse tardive d'une saisie périmée est ignorée.
  useEffect(() => {
    if (!ouvert) return;
    let perime = false;
    const minuteur = setTimeout(async () => {
      setChargement(true);
      setErreur(false);
      try {
        const res = await fetch(`/api/recherche?q=${encodeURIComponent(saisie)}`);
        if (!res.ok) throw new Error(String(res.status));
        const donnees = (await res.json()) as Reponse;
        if (!perime) {
          setReponse(donnees);
          setActif(0);
        }
      } catch {
        if (!perime) setErreur(true);
      } finally {
        if (!perime) setChargement(false);
      }
    }, DELAI_MS);
    return () => {
      perime = true;
      clearTimeout(minuteur);
    };
  }, [saisie, ouvert]);

  const options = useMemo<Option[]>(() => {
    if (!reponse) return [];
    const liste: Option[] = reponse.pages.map((p) => ({ id: `p-${p.id}`, groupe: TITRES.pages, libelle: p.libelle, detail: p.section, href: p.href }));
    for (const cat of ["chauffeurs", "vehicules", "tournees"] as const) {
      for (const e of reponse.entites[cat] ?? []) liste.push({ id: `${cat}-${e.id}`, groupe: TITRES[cat], libelle: e.libelle, detail: e.detail, href: e.href });
    }
    return liste;
  }, [reponse]);

  const aller = (o: Option) => {
    fermer();
    router.push(o.href);
  };

  // Clavier dans la fenêtre : flèches, Entrée, Échap, Tab piégé.
  const surTouche = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      fermer();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActif((a) => (options.length ? (a + 1) % options.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActif((a) => (options.length ? (a - 1 + options.length) % options.length : 0));
    } else if (e.key === "Enter" && options[actif]) {
      e.preventDefault();
      aller(options[actif]!);
    } else if (e.key === "Tab") {
      const focalisables = fenetre.current?.querySelectorAll<HTMLElement>("input, button, a[href]");
      if (!focalisables || focalisables.length === 0) return;
      const premier = focalisables[0]!;
      const dernier = focalisables[focalisables.length - 1]!;
      if (e.shiftKey && document.activeElement === premier) {
        e.preventDefault();
        dernier.focus();
      } else if (!e.shiftKey && document.activeElement === dernier) {
        e.preventDefault();
        premier.focus();
      }
    }
  };

  const idListe = `${idBase}-liste`;
  const idOption = (i: number) => `${idBase}-opt-${i}`;
  let groupeCourant = "";
  const entites = saisie.trim().length >= 2;

  return (
    <>
      <button
        ref={declencheur}
        type="button"
        onClick={() => setOuvert(true)}
        aria-label="Rechercher (Ctrl+K)"
        aria-haspopup="dialog"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-navy/70 transition-colors hover:bg-navy/[0.06] hover:text-navy"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </button>

      {ouvert && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-navy/40 p-3 pt-[10vh] sm:p-6 sm:pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && fermer()}>
          <div ref={fenetre} role="dialog" aria-modal="true" aria-label="Recherche" onKeyDown={surTouche} className="card flex max-h-[75vh] w-full max-w-xl flex-col !p-0">
            <div className="flex items-center gap-2 border-b border-navy/10 p-3">
              <input
                ref={champ}
                type="search"
                role="combobox"
                aria-expanded={options.length > 0}
                aria-controls={idListe}
                aria-autocomplete="list"
                aria-activedescendant={options[actif] ? idOption(actif) : undefined}
                aria-label="Rechercher une page, un chauffeur, un véhicule ou une tournée"
                placeholder="Page, chauffeur, immatriculation, n° de tournée…"
                value={saisie}
                maxLength={60}
                autoComplete="off"
                onChange={(e) => setSaisie(e.target.value)}
                className="input min-h-[44px] flex-1"
              />
              <button type="button" onClick={fermer} className="btn-secondary min-h-[44px] text-sm">
                Fermer
              </button>
            </div>
            <p className="sr-only" role="status" aria-live="polite">
              {chargement ? "Recherche en cours" : `${options.length} résultat${options.length > 1 ? "s" : ""}`}
            </p>
            <ul id={idListe} role="listbox" aria-label="Résultats" className="overflow-y-auto p-2">
              {options.map((o, i) => {
                const entete = o.groupe !== groupeCourant;
                groupeCourant = o.groupe;
                return (
                  <li key={o.id} role="presentation">
                    {entete && (
                      <p className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-navy/60" aria-hidden="true">
                        {o.groupe}
                      </p>
                    )}
                    <div
                      id={idOption(i)}
                      role="option"
                      aria-selected={i === actif}
                      aria-label={`${o.groupe} : ${o.libelle}${o.detail ? `, ${o.detail}` : ""}`}
                      onMouseMove={() => setActif(i)}
                      onClick={() => aller(o)}
                      className={`flex min-h-[44px] cursor-pointer flex-col justify-center rounded-xl px-3 py-1.5 text-sm ${i === actif ? "bg-navy/[0.08]" : ""}`}
                    >
                      <span className="font-medium">{o.libelle}</span>
                      {o.detail && <span className="text-xs text-navy/65">{o.detail}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
            {!chargement && !erreur && reponse && options.length === 0 && <p className="p-4 text-sm text-navy/65">Aucun résultat.</p>}
            {erreur && (
              <p role="alert" className="p-4 text-sm text-orange-ink">
                La recherche est momentanément indisponible.
              </p>
            )}
            {!entites && <p className="border-t border-navy/10 px-4 py-2 text-xs text-navy/60">Tapez 2 caractères ou plus pour chercher aussi des chauffeurs, véhicules et tournées. Échap pour fermer.</p>}
          </div>
        </div>
      )}
    </>
  );
}
