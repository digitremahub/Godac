import { Article, LegalPageLayout, listeLegale } from "@/components/legal/LegalPageLayout";
import { EDITEUR } from "@/lib/legal/editeur";

export const metadata = { title: "Engagement de niveau de service — GODAC" };

const cellule = "border border-navy/10 px-2 py-1.5 align-top";

const PRIORITES: [string, string, string, string][] = [
  ["Bloquant", "La Solution est inaccessible ou une fonction essentielle (pointage, planning, carburant, tournée) est inutilisable pour tous", "4 heures ouvrées", "Contournement sous 1 jour ouvré"],
  ["Majeur", "Une fonction est dégradée ou inutilisable pour une partie des utilisateurs, avec un contournement possible", "1 jour ouvré", "Correction sous 5 jours ouvrés"],
  ["Mineur", "Anomalie sans impact sur l’activité, question, demande d’évolution", "3 jours ouvrés", "Planifiée selon la feuille de route"],
];

export default function SlaPage() {
  return (
    <LegalPageLayout title="Engagement de niveau de service" contractuel>
      <p>
        Le présent engagement de niveau de service (« SLA ») fait partie du contrat d’abonnement GODAC. Il précise la
        disponibilité de la Solution, le support et la maintenance auxquels l’Éditeur s’engage.
      </p>

      <Article n={1} titre="Disponibilité">
        <p>
          L’Éditeur vise une disponibilité de la Solution de <strong>99,5 % par mois</strong>, mesurée hors maintenance
          planifiée et hors indisponibilités dues au Client, à ses équipements, à son accès internet ou à un cas de force
          majeure.
        </p>
      </Article>

      <Article n={2} titre="Maintenance">
        <ul className={listeLegale}>
          <li>Les mises à jour courantes sont déployées sans interruption de service.</li>
          <li>
            Une maintenance planifiée susceptible d’interrompre le service est annoncée au moins quarante-huit (48) heures à
            l’avance et réalisée de préférence entre 22 h et 6 h (heure de Paris).
          </li>
          <li>Les correctifs de sécurité urgents peuvent être appliqués sans préavis.</li>
        </ul>
      </Article>

      <Article n={3} titre="Support">
        <p>
          Le support est joignable par e-mail à <a href={`mailto:${EDITEUR.email}`} className="text-teal-ink hover:underline">{EDITEUR.email}</a>{" "}
          et depuis la Solution (assistant et demandes d’assistance), du lundi au vendredi de 9 h à 18 h, hors jours fériés.
          Les demandes sont classées par priorité :
        </p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-navy/[0.05] text-left text-navy">
                <th className={cellule}>Priorité</th>
                <th className={cellule}>Définition</th>
                <th className={cellule}>Prise en charge</th>
                <th className={cellule}>Objectif de résolution</th>
              </tr>
            </thead>
            <tbody>
              {PRIORITES.map(([p, d, c, r]) => (
                <tr key={p}>
                  <td className={cellule}>
                    <strong>{p}</strong>
                  </td>
                  <td className={cellule}>{d}</td>
                  <td className={cellule}>{c}</td>
                  <td className={cellule}>{r}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Article>

      <Article n={4} titre="Sauvegardes et continuité">
        <ul className={listeLegale}>
          <li>La base de données est sauvegardée automatiquement chaque jour ; les sauvegardes sont conservées sept (7) jours, en France.</li>
          <li>En cas d’incident majeur, l’Éditeur restaure le service à partir de la dernière sauvegarde disponible et en informe le Client.</li>
          <li>Les fichiers (photos, documents) sont stockés chez le même hébergeur, en France.</li>
        </ul>
      </Article>

      <Article n={5} titre="Information en cas d’incident">
        <p>
          En cas d’incident bloquant, l’Éditeur informe le Client par e-mail dès sa détection, puis à sa résolution, avec
          un compte rendu de la cause et des mesures prises.
        </p>
      </Article>

      <Article n={6} titre="Compensation">
        <p>
          Si la disponibilité mensuelle est inférieure à 99,5 % du fait de l’Éditeur, le Client obtient, sur demande dans les
          trente (30) jours, un avoir de 10 % de l’abonnement du mois concerné, porté à 25 % sous 98 %. Cet avoir est la
          seule compensation due au titre de la disponibilité.
        </p>
      </Article>
    </LegalPageLayout>
  );
}
