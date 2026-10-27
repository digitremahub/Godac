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
        disponibilité visée pour la Solution, le support et la maintenance. L’Éditeur est tenu à une obligation de moyens : les
        niveaux ci-dessous sont des objectifs, sauf l’avoir prévu à l’article 7.
      </p>

      <Article n={1} titre="Disponibilité">
        <p>
          L’Éditeur se donne pour objectif une disponibilité de la Solution de <strong>99,5 % par mois</strong>, mesurée à
          partir de sa supervision, hors maintenance planifiée, hors indisponibilités dues au Client, à ses équipements ou à
          son accès internet, hors cas de force majeure et hors services tiers décrits à l’article 2. Cet objectif n’est pas
          une garantie de fonctionnement continu : la Solution n’est pas déployée en haute disponibilité sur plusieurs sites.
        </p>
      </Article>

      <Article n={2} titre="Hébergeurs et services tiers">
        <p>
          La Solution repose sur des prestataires d’hébergement (application, base de données, fichiers) et sur des services
          tiers : envoi d’e-mails et de notifications, cartes, recherche d’adresses, calcul d’itinéraires (services publics ou
          ouverts) et lecture automatique par intelligence artificielle. L’Éditeur n’en maîtrise pas la disponibilité, les
          délais de réponse ni les conditions d’usage, et ne s’engage pas au-delà de ce que ces prestataires assurent eux-mêmes.
        </p>
        <ul className={listeLegale}>
          <li>
            Quand un service tiers est lent ou indisponible, la Solution se dégrade au lieu de s’arrêter : par exemple distances
            à vol d’oiseau à la place d’un itinéraire routier, ou saisie manuelle à la place de la lecture automatique. Ces
            périodes ne comptent pas comme indisponibilité de la Solution.
          </li>
          <li>L’Éditeur peut remplacer ou faire évoluer ces prestataires dans les conditions de l’accord de sous-traitance.</li>
        </ul>
      </Article>

      <Article n={3} titre="Maintenance">
        <ul className={listeLegale}>
          <li>Les mises à jour courantes sont, en principe, déployées sans interruption de service.</li>
          <li>
            Une maintenance planifiée susceptible d’interrompre le service est annoncée au moins quarante-huit (48) heures à
            l’avance et réalisée de préférence entre 22 h et 6 h (heure de Paris).
          </li>
          <li>Les correctifs de sécurité urgents peuvent être appliqués sans préavis.</li>
        </ul>
      </Article>

      <Article n={4} titre="Support">
        <p>
          Le support est joignable par e-mail à <a href={`mailto:${EDITEUR.email}`} className="text-teal-ink hover:underline">{EDITEUR.email}</a>{" "}
          et depuis la Solution (assistant et demandes d’assistance), du lundi au vendredi de 9 h à 18 h, hors jours fériés.
          Les délais ci-dessous sont des objectifs exprimés en heures ou jours ouvrés (lundi au vendredi, 9 h à 18 h). Les demandes sont classées par priorité :
        </p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-navy/[0.05] text-left text-navy">
                <th className={cellule}>Priorité</th>
                <th className={cellule}>Définition</th>
                <th className={cellule}>Objectif de prise en charge</th>
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

      <Article n={5} titre="Sauvegardes et continuité">
        <ul className={listeLegale}>
          <li>La base de données est sauvegardée automatiquement chaque jour par l’hébergeur ; les sauvegardes sont conservées sept (7) jours, en France.</li>
          <li>
            En cas d’incident majeur, l’Éditeur s’efforce de rétablir le service au plus vite à partir de la dernière sauvegarde
            disponible et en informe le Client ; les données saisies depuis cette sauvegarde (jusqu’à 24 heures) peuvent être
            perdues. Aucun délai de rétablissement chiffré n’est garanti.
          </li>
          <li>
            Les fichiers (photos, documents) sont stockés chez le même hébergeur, en France, mais ne sont pas inclus dans la
            sauvegarde quotidienne de la base : le Client garde les justificatifs d’origine qu’il doit conserver.
          </li>
        </ul>
      </Article>

      <Article n={6} titre="Information en cas d’incident">
        <p>
          En cas d’incident bloquant, l’Éditeur informe le Client par e-mail dès sa détection, puis à sa résolution, avec
          un compte rendu de la cause et des mesures prises.
        </p>
      </Article>

      <Article n={7} titre="Compensation">
        <p>
          Si la disponibilité mensuelle est inférieure à 99,5 % du fait de l’Éditeur (hors panne générale d’un hébergeur ou d’un
          service tiers), le Client obtient, sur demande dans les trente (30) jours suivant la fin du mois, un avoir de 10 % de
          l’abonnement du mois concerné, porté à 25 % sous 98 %. Cet avoir est la seule compensation due au titre de la
          disponibilité, sauf faute lourde ou dolosive de l’Éditeur.
        </p>
      </Article>
    </LegalPageLayout>
  );
}
