import { joursRestants } from "@/lib/alerts/echeances";

/**
 * Échéances RH : permis de conduire, visite médicale, fin de contrat et
 * documents du salarié (titre de séjour, diplôme, pièce d'identité) avec une
 * date d'expiration. Le cron quotidien (app/api/cron/rh-quotidien) crée une
 * alerte à chaque palier J-60, J-30, J-7 et J0 (échéance atteinte ou
 * dépassée), dédoublonnée par échéance ET par palier, et la clôt quand le
 * document est renouvelé. Même principe que lib/alerts/echeances.ts (flotte).
 *
 * Fichier pur, testé dans lib/alerts/__tests__/echeances-rh.test.ts. Jours de
 * Paris (AAAA-MM-JJ).
 *
 * Confidentialité : aucune donnée médicale dans une alerte (seulement « visite
 * médicale à renouveler »). Un manager ne reçoit que les genres non sensibles de
 * son service (permis, documents) ; visite médicale et fin de contrat vont à
 * l'exploitation et à la direction ; le titre de séjour (registre du personnel,
 * visible de la direction seule) reste à la direction.
 */

/** Paliers de rappel, en jours avant l'échéance (0 : le jour même ou dépassée). */
export const PALIERS_ECHEANCE_RH = [60, 30, 7, 0] as const;
export type PalierEcheanceRh = (typeof PALIERS_ECHEANCE_RH)[number];
export const LIBELLE_PALIER_RH: Readonly<Record<PalierEcheanceRh, string>> = { 60: "J-60", 30: "J-30", 7: "J-7", 0: "J0" };

/** Préfixe des clés de dédoublonnage : sépare ces alertes de celles de la flotte à la clôture. */
export const PREFIXE_CLE_RH = "rh:";

export type GenreEcheanceRh = "permis" | "visite" | "contrat" | "titre_sejour" | "document";

/** Type de document du salarié (employee_documents.doc_type) → genre suivi. Les autres types ne sont pas suivis. */
export const GENRE_PAR_TYPE_DOCUMENT: Readonly<Record<string, GenreEcheanceRh>> = {
  "Permis de conduire": "permis",
  "Visite médicale (aptitude)": "visite",
  "Titre de séjour / autorisation de travail": "titre_sejour",
  "Diplôme / certification": "document",
  "Pièce d'identité": "document",
};

/** Palier atteint pour ce nombre de jours restants, ou null si l'échéance est à plus de 60 jours. */
export function palierAtteintRh(jours: number): PalierEcheanceRh | null {
  if (!Number.isFinite(jours) || jours > 60) return null;
  if (jours <= 0) return 0;
  if (jours <= 7) return 7;
  if (jours <= 30) return 30;
  return 60;
}

/**
 * Destinataires par genre : le manager (son service) ne reçoit que les genres
 * non sensibles ; sensible = exploitation et direction, sans service (donc
 * invisible d'un manager par la RLS) ; titre de séjour : direction seule.
 */
export function destinatairesRh(genre: GenreEcheanceRh, serviceId: string | null): { roles: string[]; serviceId: string | null } {
  if (genre === "titre_sejour") return { roles: ["direction"], serviceId: null };
  if (genre === "visite" || genre === "contrat") return { roles: ["exploitation", "direction"], serviceId: null };
  return serviceId ? { roles: ["manager", "exploitation", "direction"], serviceId } : { roles: ["exploitation", "direction"], serviceId: null };
}

export interface DocumentSalarie {
  id: string;
  user_id: string;
  nom: string;
  doc_type: string;
  expires_at: string | null;
  uploaded_at: string;
  service_id: string | null;
}

export interface ContratSalarie {
  user_id: string;
  nom: string;
  contract_end_date: string | null;
  /** Dossier clos (terminated) : la fin de contrat n'a plus lieu d'être suivie. */
  hr_status: string | null;
  service_id: string | null;
}

export interface EcheanceRhSouhaitee {
  genre: GenreEcheanceRh;
  /** Lien de l'alerte : la fiche du salarié. */
  relatedTable: "users";
  relatedId: string;
  echeance: string;
  jours: number;
  palier: PalierEcheanceRh;
  severity: "info" | "warning" | "critical";
  message: string;
  serviceId: string | null;
  recipientRoles: string[];
  cle: string;
}

/** Clé de dédoublonnage : une alerte par échéance (genre, objet, date) et par palier. */
export function cleEcheanceRh(genre: GenreEcheanceRh, objetId: string, echeance: string, palier: PalierEcheanceRh): string {
  return `${PREFIXE_CLE_RH}${genre}:${objetId}:${echeance.slice(0, 10)}:${LIBELLE_PALIER_RH[palier]}`;
}

const severite = (palier: PalierEcheanceRh): EcheanceRhSouhaitee["severity"] => (palier === 0 ? "critical" : palier <= 7 ? "warning" : "info");
const dateFr = (jour: string) => `${jour.slice(8, 10)}/${jour.slice(5, 7)}/${jour.slice(0, 4)}`;

function delai(jours: number): string {
  if (jours < 0) return `dépassée depuis ${-jours} jour${-jours > 1 ? "s" : ""}`;
  if (jours === 0) return "aujourd'hui";
  return `dans ${jours} jour${jours > 1 ? "s" : ""}`;
}

/**
 * Document en vigueur de chaque salarié et type : le dernier déposé. Un
 * document renouvelé (nouveau fichier, nouvelle date) remplace le précédent,
 * dont l'alerte se clôt.
 */
export function documentsSalarieEnVigueur(documents: readonly DocumentSalarie[]): DocumentSalarie[] {
  const parClef = new Map<string, DocumentSalarie>();
  for (const d of documents) {
    if (!GENRE_PAR_TYPE_DOCUMENT[d.doc_type]) continue;
    const clef = `${d.user_id}|${d.doc_type}`;
    const actuel = parClef.get(clef);
    if (!actuel || d.uploaded_at > actuel.uploaded_at || (d.uploaded_at === actuel.uploaded_at && d.id > actuel.id)) parClef.set(clef, d);
  }
  return [...parClef.values()];
}

function messageRh(genre: GenreEcheanceRh, p: { nom: string; docType?: string; echeance: string; jours: number }): string {
  const quand = `échéance le ${dateFr(p.echeance)} (${delai(p.jours)})`;
  switch (genre) {
    case "permis":
      return `Permis de conduire de ${p.nom} : ${quand}. Faites-le renouveler puis déposez le nouveau dans sa fiche.`;
    // Aucune donnée médicale : seulement l'échéance.
    case "visite":
      return `Visite médicale à renouveler : ${p.nom}, ${quand}.`;
    case "contrat":
      return `Fin de contrat de ${p.nom} le ${dateFr(p.echeance)} (${delai(p.jours)}) : renouvellement ou sortie à préparer.`;
    default:
      return `${p.docType ?? "Document"} de ${p.nom} : ${quand}. Déposez le nouveau document dans sa fiche.`;
  }
}

/**
 * Alertes que la situation justifie à cet instant : une par document en
 * vigueur ou contrat dont l'échéance est à 60 jours ou moins, au palier
 * atteint. Une échéance renouvelée ou un document remplacé n'y figure plus :
 * c'est ce qui clôt l'alerte.
 */
export function echeancesRhSouhaitees(documents: readonly DocumentSalarie[], contrats: readonly ContratSalarie[], aujourdhui: string): EcheanceRhSouhaitee[] {
  const resultat: EcheanceRhSouhaitee[] = [];
  for (const d of documentsSalarieEnVigueur(documents)) {
    if (!d.expires_at) continue;
    const genre = GENRE_PAR_TYPE_DOCUMENT[d.doc_type]!;
    const jours = joursRestants(d.expires_at, aujourdhui);
    const palier = palierAtteintRh(jours);
    if (palier === null) continue;
    const dest = destinatairesRh(genre, d.service_id);
    resultat.push({
      genre,
      relatedTable: "users",
      relatedId: d.user_id,
      echeance: d.expires_at.slice(0, 10),
      jours,
      palier,
      severity: severite(palier),
      message: messageRh(genre, { nom: d.nom, docType: d.doc_type, echeance: d.expires_at, jours }),
      serviceId: dest.serviceId,
      recipientRoles: dest.roles,
      cle: cleEcheanceRh(genre, d.id, d.expires_at, palier),
    });
  }
  for (const c of contrats) {
    if (!c.contract_end_date || c.hr_status === "terminated") continue;
    const jours = joursRestants(c.contract_end_date, aujourdhui);
    const palier = palierAtteintRh(jours);
    if (palier === null) continue;
    const dest = destinatairesRh("contrat", c.service_id);
    resultat.push({
      genre: "contrat",
      relatedTable: "users",
      relatedId: c.user_id,
      echeance: c.contract_end_date.slice(0, 10),
      jours,
      palier,
      severity: severite(palier),
      message: messageRh("contrat", { nom: c.nom, echeance: c.contract_end_date, jours }),
      serviceId: dest.serviceId,
      recipientRoles: dest.roles,
      cle: cleEcheanceRh("contrat", c.user_id, c.contract_end_date, palier),
    });
  }
  return resultat.sort((x, y) => x.jours - y.jours);
}

/** Échéances pour lesquelles aucune alerte du même palier n'existe déjà. */
export function echeancesRhANotifier(souhaitees: readonly EcheanceRhSouhaitee[], dejaCreees: readonly { cle_dedoublonnage: string | null }[]): EcheanceRhSouhaitee[] {
  const deja = new Set(dejaCreees.map((a) => a.cle_dedoublonnage).filter((c): c is string => Boolean(c)));
  return souhaitees.filter((e) => !deja.has(e.cle));
}
