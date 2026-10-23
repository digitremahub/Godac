// Cache mémoire (côté client) des suggestions par préfixe saisi. Pur et testé.

import { correspondRequete, type SuggestionAdresse } from "@/lib/colis/recherche-adresses";

const normaliser = (q: string) => q.trim().toLowerCase().replace(/\s+/g, " ");

/** Biais arrondi (~1 km) : deux positions proches partagent le cache. */
export function cleBiais(biais: { lat: number; lng: number } | null | undefined): string {
  return biais ? `${biais.lat.toFixed(2)},${biais.lng.toFixed(2)}` : "-";
}

export class CacheSuggestions {
  private readonly map = new Map<string, SuggestionAdresse[]>();
  constructor(private readonly capacite = 60) {}

  private cle(q: string, biais: string) {
    return `${biais}|${normaliser(q)}`;
  }

  lire(q: string, biais: string): SuggestionAdresse[] | undefined {
    const k = this.cle(q, biais);
    const v = this.map.get(k);
    if (v) {
      this.map.delete(k);
      this.map.set(k, v); // récemment utilisé
    }
    return v;
  }

  ecrire(q: string, biais: string, resultats: SuggestionAdresse[]): void {
    const k = this.cle(q, biais);
    this.map.delete(k);
    this.map.set(k, resultats);
    while (this.map.size > this.capacite) this.map.delete(this.map.keys().next().value as string);
  }

  /**
   * Affichage immédiat pendant la frappe : résultats du plus long préfixe en
   * cache, filtrés par la requête complète (peut être vide).
   */
  depuisPrefixe(q: string, biais: string): SuggestionAdresse[] {
    const n = normaliser(q);
    for (let len = n.length - 1; len >= 3; len--) {
      const v = this.map.get(`${biais}|${n.slice(0, len).trimEnd()}`);
      if (v) return v.filter((s) => correspondRequete(`${s.nom ?? ""} ${s.adresse}`, n));
    }
    return [];
  }
}
