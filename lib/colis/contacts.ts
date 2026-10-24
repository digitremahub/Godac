/**
 * Contacts du client notés par le chauffeur sur un arrêt : « Message envoyé »
 * (contact_message) et « Eu au téléphone » (contact_phone). Valables pour
 * tous les modes et pour toutes les interfaces ; cochés dans la fiche
 * « Non livré » ou en 1 clic depuis l'arrêt.
 */
export type ChampContact = "contact_message" | "contact_phone";

export const CONTACTS = [
  { champ: "contact_message", label: "Message envoyé", court: "Message" },
  { champ: "contact_phone", label: "Eu au téléphone", court: "Tél." },
] as const;

export interface ContactsArret {
  contact_message?: boolean | null;
  contact_phone?: boolean | null;
  contact_at?: string | null;
}

/** Demande de changement (champs absents = inchangés). */
export type DemandeContacts = Partial<Record<ChampContact, boolean>>;

/**
 * Colonnes à écrire pour une demande, et libellé du journal ; `null` si rien ne change.
 * contact_at = dernière coche (effacé quand plus rien n'est coché).
 */
export function majContacts(actuel: ContactsArret, demande: DemandeContacts, maintenant: string): { update: Record<string, unknown>; details: string } | null {
  const apres = { contact_message: demande.contact_message ?? actuel.contact_message === true, contact_phone: demande.contact_phone ?? actuel.contact_phone === true };
  const changes = CONTACTS.filter((c) => (actuel[c.champ] === true) !== apres[c.champ]);
  if (!changes.length) return null;
  const cochee = changes.some((c) => apres[c.champ]);
  return {
    update: { ...apres, contact_at: apres.contact_message || apres.contact_phone ? (cochee ? maintenant : (actuel.contact_at ?? maintenant)) : null },
    details: changes.map((c) => `${c.label} : ${apres[c.champ] ? "oui" : "non"}`).join(" · "),
  };
}

/** Texte lisible des contacts d'un arrêt (« Message envoyé · Eu au téléphone ») ; null si aucun. */
export function libelleContacts(s: ContactsArret): string | null {
  const l = CONTACTS.filter((c) => s[c.champ] === true).map((c) => c.label);
  return l.length ? l.join(" · ") : null;
}

/** Arrêts d'une liste avec la demande appliquée (affichage optimiste). */
export function appliquerContacts<T extends { id: string } & ContactsArret>(stops: T[], id: string, demande: DemandeContacts, maintenant = new Date().toISOString()): T[] {
  return stops.map((s) => {
    if (s.id !== id) return s;
    const m = majContacts(s, demande, maintenant);
    return m ? { ...s, ...m.update } : s;
  });
}
