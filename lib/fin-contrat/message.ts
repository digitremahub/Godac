// Courrier de préavis de suppression des données (pur, testé).
import { EDITEUR } from "@/lib/legal/editeur";

const echapper = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const jour = (d: Date) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });

export interface ParametresPreavis {
  nomOrganisation: string;
  finContrat: Date;
  suppressionPrevue: Date;
}

/** Objet et corps HTML du préavis : date de suppression, rappel de l'export, contact pour un litige. */
export function messagePreavis(p: ParametresPreavis): { subject: string; html: string } {
  const nom = echapper(p.nomOrganisation);
  const contact = echapper(EDITEUR.email);
  const suppression = jour(p.suppressionPrevue);
  return {
    subject: `GODAC : vos données seront supprimées le ${suppression}`,
    html: [
      `<p>Bonjour,</p>`,
      `<p>Le contrat GODAC de <strong>${nom}</strong> a pris fin le ${jour(p.finContrat)}. Conformément à nos conditions (CGV, article 11),`,
      `vos données seront <strong>supprimées définitivement le ${suppression}</strong>, sauf obligation légale de conservation.</p>`,
      `<p><strong>Pour récupérer vos données avant cette date</strong> : exportez-les depuis votre espace GODAC si votre accès est encore ouvert, ou`,
      `demandez un export (fichiers CSV) en répondant à ce message ou à <a href="mailto:${contact}">${contact}</a> avant le ${suppression}.`,
      `Pensez à conserver vous-même les documents que la loi vous impose d'archiver (notamment les bulletins de paie, les factures et les justificatifs fiscaux) :`,
      `GODAC n'est pas un service d'archivage légal.</p>`,
      `<p>Si vous souhaitez poursuivre avec GODAC, ou en cas de litige en cours, écrivez-nous avant cette date : la suppression peut être suspendue.</p>`,
      `<p>Cordialement,<br/>L'équipe GODAC</p>`,
    ].join("\n"),
  };
}
