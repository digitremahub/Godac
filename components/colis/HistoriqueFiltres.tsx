"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

interface Option {
  id: string;
  label: string;
}

/** Ligne du tableau d'historique : toute la ligne ouvre le détail (le lien reste pour le clavier). */
export function LigneCliquable({ href, selection, children }: { href: string; selection: boolean; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <tr
      className={`cursor-pointer border-t border-navy/5 hover:bg-navy/[0.03] ${selection ? "bg-teal/10" : ""}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a")) return;
        router.push(href);
      }}
    >
      {children}
    </tr>
  );
}

/**
 * Filtres de l'historique des tournées colis, reflétés dans l'URL
 * (?onglet=historique&du=&au=&service=&chauffeur=&camion=) : un lien
 * copié rouvre exactement la même vue.
 */
export function HistoriqueFiltres({
  du,
  au,
  services,
  chauffeurs,
  camions,
}: {
  du: string;
  au: string;
  services: Option[] | null;
  chauffeurs: Option[] | null;
  camions: Option[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function changer(cle: string, valeur: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("onglet", "historique");
    if (valeur) params.set(cle, valeur);
    else params.delete(cle);
    // Nouveau filtre : première page, détail refermé.
    params.delete("page");
    params.delete("tournee");
    router.push(`/colis?${params.toString()}`);
  }

  const select = (cle: string, libelle: string, tous: string, options: Option[]) => (
    <select aria-label={libelle} className="input !w-auto" value={searchParams.get(cle) ?? ""} onChange={(e) => changer(cle, e.target.value)}>
      <option value="">{tous}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );

  const filtre = ["du", "au", "service", "chauffeur", "camion", "q", "statut"].some((k) => searchParams.get(k)) || Boolean(searchParams.get("page"));
  const [texte, setTexte] = useState(searchParams.get("q") ?? "");
  useEffect(() => setTexte(searchParams.get("q") ?? ""), [searchParams]);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <form
        className="flex w-full flex-wrap items-center gap-2"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          changer("q", texte.trim());
        }}
      >
        <input
          type="search"
          className="input min-w-0 flex-1"
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          placeholder="Rechercher un colis : code, destinataire ou adresse (3 caractères min.)"
          aria-label="Rechercher un colis par code, destinataire ou adresse"
        />
        <select aria-label="Filtrer par statut de livraison" className="input !w-auto" value={searchParams.get("statut") ?? ""} onChange={(e) => changer("statut", e.target.value)}>
          <option value="">Tous les statuts</option>
          <option value="delivered">Livrés</option>
          <option value="failed">Échecs</option>
          <option value="pending">Non faits</option>
        </select>
        <button type="submit" className="btn-secondary !py-2 text-sm">
          Rechercher
        </button>
      </form>
      <label className="flex items-center gap-1.5 text-sm text-navy/70">
        Du
        <input type="date" aria-label="Du" className="input !w-auto" value={du} max={au} onChange={(e) => changer("du", e.target.value)} />
      </label>
      <label className="flex items-center gap-1.5 text-sm text-navy/70">
        Au
        <input type="date" aria-label="Au" className="input !w-auto" value={au} min={du} onChange={(e) => changer("au", e.target.value)} />
      </label>
      {services && select("service", "Filtrer par service", "Tous les services", services)}
      {chauffeurs && select("chauffeur", "Filtrer par chauffeur", "Tous les chauffeurs", chauffeurs)}
      {select("camion", "Filtrer par camion", "Tous les camions", camions)}
      {filtre && (
        <button type="button" className="btn-secondary !px-3 !py-1.5 text-sm" onClick={() => router.push("/colis?onglet=historique")}>
          Réinitialiser
        </button>
      )}
    </div>
  );
}
