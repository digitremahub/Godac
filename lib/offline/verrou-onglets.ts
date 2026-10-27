// Verrou entre onglets pour le rejeu de la file hors ligne : un seul onglet
// à la fois envoie les actions en attente (sinon deux onglets rejouent la
// même action en parallèle). navigator.locks quand il existe, sinon un
// verrou localStorage avec expiration. Logique du repli testée dans
// lib/offline/__tests__/verrou-onglets.test.ts.

const NOM_VERROU = "godac-rejeu-hors-ligne";
const CLE_STOCKAGE = "godac.rejeu.verrou";
/** Un verrou plus ancien est considéré abandonné (onglet fermé en plein rejeu). */
export const EXPIRATION_VERROU_MS = 60_000;

export interface StockageVerrou {
  getItem(cle: string): string | null;
  setItem(cle: string, valeur: string): void;
  removeItem(cle: string): void;
}

/** Prend le verrou de repli s'il est libre ou expiré ; relit après écriture pour départager deux onglets simultanés. */
export function prendreVerrouStockage(stockage: StockageVerrou, id: string, maintenant: number, expirationMs: number = EXPIRATION_VERROU_MS): boolean {
  try {
    const actuel = JSON.parse(stockage.getItem(CLE_STOCKAGE) ?? "null") as { id?: string; expire?: number } | null;
    if (actuel && typeof actuel.expire === "number" && actuel.expire > maintenant && actuel.id !== id) return false;
    stockage.setItem(CLE_STOCKAGE, JSON.stringify({ id, expire: maintenant + expirationMs }));
    return (JSON.parse(stockage.getItem(CLE_STOCKAGE) ?? "null") as { id?: string } | null)?.id === id;
  } catch {
    // Stockage illisible : mieux vaut rejouer (idempotence côté serveur) que ne jamais envoyer.
    return true;
  }
}

export function libererVerrouStockage(stockage: StockageVerrou, id: string): void {
  try {
    const actuel = JSON.parse(stockage.getItem(CLE_STOCKAGE) ?? "null") as { id?: string } | null;
    if (actuel?.id === id) stockage.removeItem(CLE_STOCKAGE);
  } catch {
    /* rien à libérer */
  }
}

/** Exécute `travail` si aucun autre onglet ne rejoue ; sinon renvoie `siOccupe` sans rien faire. */
export async function avecVerrouRejeu<T>(travail: () => Promise<T>, siOccupe: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    return navigator.locks.request(NOM_VERROU, { ifAvailable: true }, async (verrou) => (verrou ? travail() : siOccupe()));
  }
  if (typeof localStorage === "undefined") return travail();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  if (!prendreVerrouStockage(localStorage, id, Date.now())) return siOccupe();
  try {
    return await travail();
  } finally {
    libererVerrouStockage(localStorage, id);
  }
}
