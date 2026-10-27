/**
 * Échéances de la flotte : contrôle technique, assurance, licence et autres
 * papiers du véhicule, date limite de paiement minoré des amendes. Le cron
 * quotidien (app/api/cron/echeances-flotte) crée une alerte à chaque palier
 * J-30, J-7 et J0 (échéance atteinte ou dépassée), « À traiter » liste les
 * mêmes échéances (lib/a-traiter/serveur.ts).
 *
 * Fichier pur (aucune dépendance serveur), même principe que
 * lib/exploitation/surveillance.ts : le cron lit les documents et les amendes,
 * ce fichier décide quelles alertes la situation justifie, lesquelles existent
 * déjà (dédoublonnage par échéance ET par palier) et lesquelles se closent
 * (document renouvelé, amende réglée : lib/alerts/cloture.ts). Testé dans
 * lib/alerts/__tests__/echeances.test.ts. Les jours sont ceux de Paris
 * (AAAA-MM-JJ).
 */

/** Paliers de rappel, en jours avant l'échéance (0 : le jour même ou dépassée). */
export const PALIERS_ECHEANCE = [30, 7, 0] as const;
export type PalierEcheance = (typeof PALIERS_ECHEANCE)[number];

export const LIBELLE_PALIER: Readonly<Record<PalierEcheance, string>> = { 30: "J-30", 7: "J-7", 0: "J0" };

/** Types de documents sans échéance propre à suivre (carte grise) ou à regrouper (« Autre » : plusieurs documents distincts). */
const TYPE_AUTRE = "Autre";

/** Rôles destinataires : le manager reçoit les véhicules de son service, exploitation et direction toute l'organisation. */
export function rolesDestinataires(serviceId: string | null | undefined): string[] {
  return serviceId ? ["manager", "exploitation", "direction"] : ["exploitation", "direction"];
}

const MS_JOUR = 86_400_000;

/** Jours entiers de `aujourdhui` à `echeance` (négatif : dépassée). */
export function joursRestants(echeance: string, aujourdhui: string): number {
  return Math.round((Date.parse(`${echeance.slice(0, 10)}T00:00:00Z`) - Date.parse(`${aujourdhui}T00:00:00Z`)) / MS_JOUR);
}

/** Palier atteint pour ce nombre de jours restants : le plus proche de l'échéance, ou null si elle est à plus de 30 jours. */
export function palierAtteint(jours: number): PalierEcheance | null {
  if (!Number.isFinite(jours) || jours > 30) return null;
  if (jours <= 0) return 0;
  if (jours <= 7) return 7;
  return 30;
}

export interface DocumentVehicule {
  id: string;
  vehicle_id: string;
  doc_type: string;
  expires_on: string | null;
  uploaded_at: string;
  registration: string;
  service_id: string | null;
}

export interface AmendeAEcheance {
  id: string;
  registration: string;
  service_id: string | null;
  status: string;
  payment_deadline: string | null;
  amount: number;
  reduced_amount: number | null;
  reference: string | null;
}

export type GenreEcheance = "document" | "amende";

export interface EcheanceSouhaitee {
  genre: GenreEcheance;
  /** Lien de l'alerte : la fiche du véhicule (papiers) ou l'amende. */
  relatedTable: "vehicles" | "fines";
  relatedId: string;
  vehicleId: string | null;
  echeance: string;
  jours: number;
  palier: PalierEcheance;
  severity: "info" | "warning" | "critical";
  message: string;
  serviceId: string | null;
  recipientRoles: string[];
  cle: string;
}

/** Clé de dédoublonnage : une alerte par échéance (document ou amende, date comprise) et par palier. */
export function cleEcheance(genre: GenreEcheance, relatedId: string, echeance: string, palier: PalierEcheance): string {
  return `${genre}:${relatedId}:${echeance.slice(0, 10)}:${LIBELLE_PALIER[palier]}`;
}

const severite = (palier: PalierEcheance): EcheanceSouhaitee["severity"] => (palier === 0 ? "critical" : palier === 7 ? "warning" : "info");

const dateFr = (jour: string) => `${jour.slice(8, 10)}/${jour.slice(5, 7)}/${jour.slice(0, 4)}`;

function delai(jours: number): string {
  if (jours < 0) return `dépassée depuis ${-jours} jour${-jours > 1 ? "s" : ""}`;
  if (jours === 0) return "aujourd'hui";
  return `dans ${jours} jour${jours > 1 ? "s" : ""}`;
}

/**
 * Document en vigueur de chaque véhicule et type : le dernier déposé. Un
 * document renouvelé (nouveau fichier, nouvelle date) remplace le précédent, dont
 * l'alerte se clôt ; « Autre » regroupe des documents distincts, tous suivis.
 */
export function documentsEnVigueur(documents: readonly DocumentVehicule[]): DocumentVehicule[] {
  const parClef = new Map<string, DocumentVehicule>();
  const autres: DocumentVehicule[] = [];
  for (const d of documents) {
    if (d.doc_type === TYPE_AUTRE) {
      autres.push(d);
      continue;
    }
    const clef = `${d.vehicle_id}|${d.doc_type}`;
    const actuel = parClef.get(clef);
    if (!actuel || d.uploaded_at > actuel.uploaded_at || (d.uploaded_at === actuel.uploaded_at && d.id > actuel.id)) parClef.set(clef, d);
  }
  return [...parClef.values(), ...autres];
}

/** Statuts d'amende dont le paiement reste à faire. */
export const STATUTS_AMENDE_OUVERTE = ["pending_identification", "identified", "contested"] as const;

/**
 * Alertes que la situation justifie à cet instant : une par document en
 * vigueur ou amende ouverte dont l'échéance est à 30 jours ou moins, au palier
 * atteint (J-30, J-7, J0). Une échéance renouvelée, un document remplacé, une
 * amende réglée ou classée n'y figurent plus : c'est ce qui clôt l'alerte.
 */
export function echeancesSouhaitees(documents: readonly DocumentVehicule[], amendes: readonly AmendeAEcheance[], aujourdhui: string): EcheanceSouhaitee[] {
  const resultat: EcheanceSouhaitee[] = [];
  for (const d of documentsEnVigueur(documents)) {
    if (!d.expires_on) continue;
    const jours = joursRestants(d.expires_on, aujourdhui);
    const palier = palierAtteint(jours);
    if (palier === null) continue;
    resultat.push({
      genre: "document",
      relatedTable: "vehicles",
      relatedId: d.vehicle_id,
      vehicleId: d.vehicle_id,
      echeance: d.expires_on.slice(0, 10),
      jours,
      palier,
      severity: severite(palier),
      message: `${d.doc_type} du véhicule ${d.registration} : échéance le ${dateFr(d.expires_on)} (${delai(jours)}). Renouvelez le document puis déposez le nouveau dans la fiche du véhicule.`,
      serviceId: d.service_id,
      recipientRoles: rolesDestinataires(d.service_id),
      cle: cleEcheance("document", d.id, d.expires_on, palier),
    });
  }
  for (const a of amendes) {
    if (!a.payment_deadline || !(STATUTS_AMENDE_OUVERTE as readonly string[]).includes(a.status)) continue;
    const jours = joursRestants(a.payment_deadline, aujourdhui);
    const palier = palierAtteint(jours);
    if (palier === null) continue;
    const montant = (a.reduced_amount ?? a.amount).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
    resultat.push({
      genre: "amende",
      relatedTable: "fines",
      relatedId: a.id,
      vehicleId: null,
      echeance: a.payment_deadline.slice(0, 10),
      jours,
      palier,
      severity: severite(palier),
      message: `Amende${a.reference ? ` ${a.reference}` : ""} (${a.registration}) : paiement du montant minoré (${montant}) avant le ${dateFr(a.payment_deadline)} (${delai(jours)}). Passé ce délai, le montant est majoré.`,
      serviceId: a.service_id,
      recipientRoles: rolesDestinataires(a.service_id),
      cle: cleEcheance("amende", a.id, a.payment_deadline, palier),
    });
  }
  return resultat.sort((x, y) => x.jours - y.jours);
}

/** Échéances pour lesquelles aucune alerte du même palier n'existe déjà (dédoublonnage par échéance et par palier). */
export function echeancesANotifier(souhaitees: readonly EcheanceSouhaitee[], dejaCreees: readonly { cle_dedoublonnage: string | null }[]): EcheanceSouhaitee[] {
  const deja = new Set(dejaCreees.map((a) => a.cle_dedoublonnage).filter((c): c is string => Boolean(c)));
  return souhaitees.filter((e) => !deja.has(e.cle));
}
