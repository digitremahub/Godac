/**
 * Textes des notifications envoyées au concerné (alerte personnelle,
 * relayée en push et e-mail par app/api/webhooks/supabase-alerts) et à
 * l'encadrement. Purs, testés dans lib/rattachement/__tests__/notifications.test.ts.
 * Les alertes sont limitées à 480 caractères (comme les contestations existantes).
 */
import { dateParis, jourMoisParis, montantEuros } from "@/lib/rattachement/format";

const borne = (s: string) => (s.length > 480 ? `${s.slice(0, 479)}…` : s);

export interface InfosAmende {
  infractionAt: string;
  immatriculation: string | null;
  montant: number;
  montantMinore?: number | null;
  dateLimite?: string | null;
  reference?: string | null;
  lieu?: string | null;
}

/** « Une amende du 12/10 (véhicule AB-123-CD) vous est attribuée : 135 €, à régler avant le 26/10/2026. » */
export function messageAmendeAttribuee(a: InfosAmende): string {
  let s = `Une amende du ${jourMoisParis(a.infractionAt)}`;
  if (a.immatriculation) s += ` (véhicule ${a.immatriculation})`;
  s += ` vous est attribuée : ${montantEuros(a.montant)}`;
  if (a.montantMinore !== null && a.montantMinore !== undefined) s += ` (${montantEuros(a.montantMinore)} si réglée rapidement)`;
  if (a.dateLimite) s += `, à régler avant le ${dateParis(a.dateLimite)}`;
  s += ".";
  if (a.lieu) s += ` Lieu : ${a.lieu}.`;
  if (a.reference) s += ` Avis n°${a.reference}.`;
  return borne(s);
}

const LIBELLE_STATUT_AMENDE: Record<string, string> = {
  paid: "marquée réglée",
  contested: "contestée auprès de l'administration",
  dismissed: "classée",
  pending_identification: "remise à identifier",
  identified: "maintenue à votre nom",
};

export function messageAmendeStatut(a: Pick<InfosAmende, "infractionAt" | "immatriculation">, statut: string): string {
  return borne(`Votre amende du ${jourMoisParis(a.infractionAt)}${a.immatriculation ? ` (véhicule ${a.immatriculation})` : ""} a été ${LIBELLE_STATUT_AMENDE[statut] ?? statut}.`);
}

export interface InfosContestation {
  parcelCode: string | null;
  clientName: string | null;
  livreLe: string | null;
  deliveryDate: string | null;
  reason: string | null;
}

/** « Une contestation client vous concerne : colis X livré le 12/10/2026. » */
export function messageContestationAttribuee(c: InfosContestation): string {
  let s = "Une contestation client vous concerne";
  const objet: string[] = [];
  if (c.parcelCode) objet.push(`colis ${c.parcelCode}`);
  if (c.livreLe) objet.push(`livré le ${dateParis(c.livreLe)}`);
  else if (c.deliveryDate) objet.push(`livraison du ${dateParis(c.deliveryDate)}`);
  if (objet.length) s += ` : ${objet.join(" ")}`;
  if (c.clientName) s += ` (${c.clientName})`;
  s += ".";
  if (c.reason) s += ` Motif : ${c.reason}`;
  return borne(s);
}

export function messageContestationCloturee(c: Pick<InfosContestation, "parcelCode" | "clientName">, statut: "resolved" | "rejected"): string {
  const objet = c.parcelCode ? ` (colis ${c.parcelCode})` : c.clientName ? ` de ${c.clientName}` : "";
  return borne(`La contestation client${objet} a été ${statut === "resolved" ? "réglée" : "contestée / classée sans suite"}.`);
}

/** Explication du chauffeur → encadrement. */
export function messageExplicationChauffeur(auteur: string, objet: "amende" | "contestation", photos: number, extrait: string): string {
  const pj = photos > 0 ? ` (${photos} photo${photos > 1 ? "s" : ""})` : "";
  const texte = extrait.trim() ? ` : « ${extrait.trim().slice(0, 200)} »` : "";
  return borne(`${auteur} a ajouté une explication${pj} sur ${objet === "amende" ? "son amende" : "une contestation client"}${texte}`);
}

/** Message de l'encadrement → chauffeur. */
export function messageCommentaireEncadrement(auteur: string, objet: "amende" | "contestation", extrait: string): string {
  return borne(`${auteur} a écrit sur ${objet === "amende" ? "votre amende" : "votre contestation client"} : « ${extrait.trim().slice(0, 300)} »`);
}
