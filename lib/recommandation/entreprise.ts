/**
 * Clé de regroupement des recommandations d'une même entreprise : nom en
 * minuscules, sans accents, sans ponctuation, espaces réduits et sans
 * forme juridique (SAS, SARL, EURL, SA, SASU, SNC, SCOP, EI, GIE…).
 * « Transports Dupont S.A.R.L. » et « transports  dupont sarl » donnent la
 * même clé. Logique pure, calculée côté code avant l'insertion.
 */
const FORMES_JURIDIQUES = new Set(["sas", "sasu", "sarl", "eurl", "sa", "snc", "scop", "sci", "sca", "scs", "ei", "eirl", "gie", "selarl", "sep"]);

export function cleEntreprise(nom: string | null | undefined): string {
  const base = (nom ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // « S.A.R.L. » → « sarl » : on retire les points entre deux lettres isolées.
    .replace(/\b([a-z])\.(?=[a-z]\b)/g, "$1")
    .replace(/\.(?=\s|$)/g, "")
    .replace(/&/g, " et ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const mots = base.split(" ").filter(Boolean);
  const sansForme = mots.filter((m) => !FORMES_JURIDIQUES.has(m));
  // Nom réduit à une forme juridique (« SARL ») : on garde les mots d'origine.
  return (sansForme.length ? sansForme : mots).join(" ");
}

/** Nom d'entreprise saisi : espaces normalisés (affichage et stockage). */
export function nettoyerNomEntreprise(nom: string): string {
  return nom.replace(/\s+/g, " ").trim();
}
