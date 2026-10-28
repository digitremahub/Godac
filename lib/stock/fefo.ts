import type { LotDlcProche } from "@/lib/stock/alertes";
import { DEFINITION_PROFILS, profilsArticles, resoudreProfil, type CleProfil, type Profil, type ProfilsConfig } from "@/lib/stock/profils";
import { joursAvantDlc, type Solde } from "@/lib/stock/soldes";

/**
 * FEFO (first expired, first out) et alertes de DLC proche (fichier pur, testé dans
 * lib/stock/__tests__/fefo.test.ts). À la sortie d'un article suivi par lot et DLC, on propose le
 * lot dont la date limite est la plus proche. C'est une SUGGESTION d'aide logistique : l'opérateur
 * garde le choix, et le respect des règles sanitaires du secteur reste à la charge de l'entreprise.
 */

/** Profil d'un article : le sien s'il est actif, sinon le premier profil « articles » actif. */
export function profilDeLArticle(article: { profil?: string | null }, actifs: readonly CleProfil[], config: ProfilsConfig | null | undefined): Profil | null {
  const p = article.profil as CleProfil | null | undefined;
  if (p && p in DEFINITION_PROFILS && actifs.includes(p)) return resoudreProfil(p, config);
  const premier = profilsArticles(actifs, config)[0];
  return premier ? resoudreProfil(premier, config) : null;
}

/** Soldes d'un article en stock, du plus proche de sa DLC au plus lointain (sans DLC en dernier, puis par lot). */
export function triFefo<T extends Pick<Solde, "dlc" | "lot" | "quantite">>(soldes: readonly T[]): T[] {
  return soldes
    .filter((s) => s.quantite > 0)
    .sort((a, b) => {
      if (a.dlc && b.dlc) return a.dlc < b.dlc ? -1 : a.dlc > b.dlc ? 1 : a.lot.localeCompare(b.lot, "fr");
      if (a.dlc) return -1;
      if (b.dlc) return 1;
      return a.lot.localeCompare(b.lot, "fr");
    });
}

/** Lot à sortir en premier pour un article (au dépôt demandé s'il est indiqué), ou null si aucun lot n'a de DLC. */
export function suggestionFefo<T extends Pick<Solde, "article_id" | "site_id" | "dlc" | "lot" | "quantite">>(soldes: readonly T[], articleId: string, siteId?: string): T | null {
  const candidats = triFefo(soldes.filter((s) => s.article_id === articleId && (!siteId || s.site_id === siteId)));
  const premier = candidats[0];
  return premier?.dlc ? premier : null;
}

/** Phrase d'aide à l'écran de sortie. */
export function phraseFefo(s: Pick<Solde, "lot" | "dlc" | "quantite">, aujourdhui: string): string {
  const jours = joursAvantDlc(s.dlc, aujourdhui);
  const date = s.dlc ? s.dlc.split("-").reverse().join("/") : "";
  const quand = jours === null ? "" : jours < 0 ? ` (dépassée de ${-jours} j)` : jours === 0 ? " (aujourd'hui)" : ` (dans ${jours} j)`;
  return `Suggestion FEFO : sortir d'abord ${s.lot ? `le lot ${s.lot}` : "le stock sans numéro de lot"}, DLC ${date}${quand}.`;
}

/** Délai d'alerte (jours) d'un profil, ou null s'il n'alerte pas. */
export const delaiDlc = (p: Profil | null): number | null => p?.alertes.dlcJours ?? null;

/**
 * Lots dont la DLC tombe dans le délai du profil de leur article (ou est dépassée). Les articles inactifs
 * et sans stock sont ignorés ; un profil sans règle de DLC n'alerte pas.
 */
export function lotsDlcProches(
  articles: readonly { id: string; code: string; nom: string; unite: string; actif: boolean; profil?: string | null }[],
  soldes: readonly Solde[],
  aujourdhui: string,
  actifs: readonly CleProfil[],
  config: ProfilsConfig | null | undefined,
): (LotDlcProche & { cle: string })[] {
  const parId = new Map(articles.map((a) => [a.id, a]));
  const cumul = new Map<string, LotDlcProche & { cle: string }>();
  for (const s of soldes) {
    const a = parId.get(s.article_id);
    if (!a || !a.actif || s.quantite <= 0 || !s.dlc) continue;
    const delai = delaiDlc(profilDeLArticle(a, actifs, config));
    if (delai === null) continue;
    const jours = joursAvantDlc(s.dlc, aujourdhui);
    if (jours === null || jours > delai) continue;
    const cle = `stock:dlc:${a.id}:${s.lot || "-"}`;
    const ex = cumul.get(cle);
    if (ex) {
      ex.quantite += s.quantite;
      if (s.dlc < ex.dlc) {
        ex.dlc = s.dlc;
        ex.jours = jours;
      }
    } else cumul.set(cle, { cle, article: { id: a.id, code: a.code, nom: a.nom }, lot: s.lot, dlc: s.dlc, jours, quantite: s.quantite, unite: a.unite });
  }
  return [...cumul.values()].sort((x, y) => x.jours - y.jours || x.article.nom.localeCompare(y.article.nom, "fr"));
}

/** Unités individualisées dont la DLC tombe dans le délai de leur profil (en stock seulement). */
export function unitesDlcProches(
  unites: readonly { profil: string | null; dlc: string | null; statut: string }[],
  aujourdhui: string,
  actifs: readonly CleProfil[],
  config: ProfilsConfig | null | undefined,
): { nombre: number; delaiMax: number } {
  let nombre = 0;
  let delaiMax = 0;
  for (const u of unites) {
    if (!u.dlc || (u.statut !== "dans_depot" && u.statut !== "retour")) continue;
    const cle = (u.profil && u.profil in DEFINITION_PROFILS ? u.profil : actifs[0]) as CleProfil | undefined;
    const delai = cle ? delaiDlc(resoudreProfil(cle, config)) : null;
    if (delai === null) continue;
    const jours = joursAvantDlc(u.dlc, aujourdhui);
    if (jours !== null && jours <= delai) {
      nombre += 1;
      delaiMax = Math.max(delaiMax, delai);
    }
  }
  return { nombre, delaiMax };
}
